import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Binding } from '../src/sls-refund/observer.js';
import { parseRefundQueueSettings, readRefundDelivery, refundQueue } from '../src/sls-refund/smq.js';

const account = '1234567890123456';
const binding: Binding = { mode: 'live', region: 'cn-hangzhou', project: 'fixture-project', rule: 'fixture-rule', start: 100 };
const envelope = { specversion: '1.0', source: 'acs.sls.alert', type: 'sls:AlertEvent:Firing', id: 'fixture-firing-1',
  data: { aliuid: account, region: binding.region, project: binding.project, alert_id: binding.rule, status: 'firing', alert_time: 160 } };

test('SMQ validates the dedicated account, region, project, rule and firing time before admitting a notification', () => {
  assert.deepEqual(readRefundDelivery({ MessageBody: JSON.stringify(envelope), ReceiptHandle: 'receipt' }, binding, account, 200),
    { id: envelope.id, at: 160, receipt: 'receipt' });
  for (const data of [
    { aliuid: '1234567890123457' }, { region: 'cn-shanghai' }, { project: 'other' }, { alert_id: 'other-rule' },
    { status: 'resolved' }, { alert_time: 99 }, { alert_time: 201 },
  ]) {
    const value = { ...envelope, data: { ...envelope.data, ...data } };
    assert.throws(() => readRefundDelivery({ MessageBody: JSON.stringify(value), ReceiptHandle: 'receipt' }, binding, account, 200), /registered alert/);
  }
  for (const override of [{ type: 'sls:AlertEvent:Resolved' }, { source: 'untrusted' }, { specversion: '0.1' }, { id: 'bad\nid' }]) {
    assert.throws(() => readRefundDelivery({ MessageBody: JSON.stringify({ ...envelope, ...override }), ReceiptHandle: 'receipt' },
      binding, account, 200), /registered alert/);
  }
  assert.throws(() => readRefundDelivery({ MessageBody: JSON.stringify(envelope), ReceiptHandle: 'receipt&other=query' },
    binding, account, 200), /invalid refund queue message/i);
});

test('the official SMQ SDK uses the bound endpoint and scoped temporary session for receive and acknowledgement', async t => {
  const path = mkdtempSync(join(tmpdir(), 'bridge-smq-sts-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  const executable = join(path, 'sts');
  const argumentsFile = join(path, 'arguments.json');
  writeFileSync(executable, '#!' + process.execPath + '\n' +
    `require('node:fs').appendFileSync(${JSON.stringify(argumentsFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');
    console.log(JSON.stringify({ Credentials: { AccessKeyId: 'fixture-session', AccessKeySecret: 'fixture-secret',
      SecurityToken: 'fixture-token', Expiration: '2099-01-01T00:00:00Z' } }));`, { mode: 0o700 });
  const require = createRequire(import.meta.url);
  const httpx = createRequire(require.resolve('@alicloud/mns'))('httpx');
  const receipt = '1-abc+def/ghi=';
  const requests: { url: string; method: string }[] = [];
  const cloud = { ...envelope, data: { ...envelope.data, alert_time: Math.floor(Date.now() / 1000) - 5 } };
  const fixtureXml = [
    ['Message', '<MessageBody>' + JSON.stringify(cloud) + '</MessageBody><ReceiptHandle>' + receipt + '</ReceiptHandle>', 200],
    ['Empty', '', 204],
    ['Error', '<Code>MessageNotExist</Code><Message>Empty</Message><RequestId>example</RequestId><HostId>example</HostId>', 404],
  ] as const;
  let served = 0;
  const server = createServer((_request, response) => {
    const [tag, inner, code] = fixtureXml[served++]!;
    const send = () => response.writeHead(code, { 'content-type': 'text/xml' })
      .end(inner ? '<' + tag + '>' + inner + '</' + tag + '>' : '');
    if (code === 404) setTimeout(send, 5_200);
    else send();
  });
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const request = httpx.request.bind(httpx);
  t.mock.method(httpx, 'request', (url: string, options: { method: string; headers: Record<string, string> }) => {
    requests.push({ url, method: options.method });
    assert.equal(options.headers['security-token'], 'fixture-token');
    const parsed = new URL(url);
    return request('http://127.0.0.1:' + address.port + parsed.pathname + parsed.search, options);
  });
  const settings = parseRefundQueueSettings({ account, name: 'fixture-refund-alerts', profile: 'fixture-role-source',
    roleArn: 'acs:ram::' + account + ':role/fixture-smq-consumer' }, binding.region)!;
  const queue = refundQueue(settings, binding, executable);
  let running = true;
  const pending = queue.receive(() => running);
  running = false;
  assert.equal(await pending, undefined);
  assert.equal(requests.length, 0);
  const delivery = await queue.receive();
  assert.deepEqual(delivery, { id: envelope.id, at: cloud.data.alert_time, receipt });
  await queue.acknowledge(receipt);
  assert.equal(await queue.receive(), undefined);
  const base = 'https://' + account + '.mns.cn-hangzhou.aliyuncs.com/queues/' + settings.name + '/messages?';
  assert.deepEqual(requests, [
    { url: base + 'waitseconds=20', method: 'GET' },
    { url: base + 'ReceiptHandle=' + encodeURIComponent(receipt), method: 'DELETE' },
    { url: base + 'waitseconds=20', method: 'GET' },
  ]);
  const invocations = readFileSync(argumentsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
  assert.equal(invocations.length, 1);
  const args = invocations[0]!;
  assert.deepEqual(args.slice(0, 8), ['sts', 'AssumeRole', '--profile', settings.profile, '--region', binding.region, '--RoleArn', settings.roleArn]);
  assert.deepEqual(JSON.parse(args[args.indexOf('--Policy') + 1]!), { Version: '1', Statement: [{
    Effect: 'Allow', Action: ['mns:ReceiveMessage', 'mns:DeleteMessage'],
    Resource: ['acs:mns:cn-hangzhou:' + account + ':/queues/' + settings.name + '/messages'],
  }] });
});

test('signed queue requests are disabled when only the HTTP transport debug namespace is enabled', t => {
  const require = createRequire(import.meta.url);
  const sdkRequire = createRequire(require.resolve('@alicloud/mns'));
  const debug = createRequire(sdkRequire.resolve('httpx'))('debug');
  const original = process.env.DEBUG;
  t.after(() => {
    debug.enable(original ?? '');
    if (original === undefined) delete process.env.DEBUG;
  });
  const settings = { account, name: 'fixture-refund-alerts', profile: 'example',
    roleArn: 'acs:ram::' + account + ':role/fixture-smq-consumer' };
  for (const namespace of ['httpx:header', 'httpx:body']) {
    debug.enable(namespace);
    assert.throws(() => refundQueue(settings, binding, '/fixture/unused-cli'), /SDK and transport debug logging/);
  }
});
