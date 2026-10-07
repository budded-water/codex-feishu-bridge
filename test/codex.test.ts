import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CodexClient } from '../src/codex/client.js';
import { until } from './helpers.js';

const fixture = fileURLToPath(new URL('./fixtures/codex.mjs', import.meta.url));

test('stdio client initializes and correlates out-of-order replies', async t => {
  const client = new CodexClient(process.execPath, [fixture]); t.after(() => client.close());
  await client.start();
  const responses = await Promise.all([
    client.request('echo', { value: 'slow', delay: 20 }),
    client.request('echo', { value: 'fast', delay: 0 }),
  ]);
  assert.deepEqual(responses, [{ value: 'slow', initialized: true }, { value: 'fast', initialized: true }]);
});

test('server requests receive one correlated response; gateway credentials are not inherited', async t => {
  const previous = process.env.FEISHU_APP_SECRET;
  process.env.FEISHU_APP_SECRET = 'private-test-secret';
  const client = new CodexClient(process.execPath, [fixture]);
  t.after(async () => { await client.close(); if (previous === undefined) delete process.env.FEISHU_APP_SECRET; else process.env.FEISHU_APP_SECRET = previous; });
  let acknowledged = false;
  client.onRequest(request => { client.reply(request.id, { decision: 'decline' }); client.reply(request.id, { decision: 'accept' }); });
  client.onNotification(event => { if (event.method === 'approval/responded') { assert.equal(event.params.decision, 'decline'); acknowledged = true; } });
  await client.start();
  assert.deepEqual(await client.request('env', {}), { secretPresent: false });
  await client.request('ask', {});
  await until(() => acknowledged);
});

test('process death rejects all outstanding calls and clears readiness', async t => {
  const client = new CodexClient(process.execPath, [fixture]); t.after(() => client.close());
  await client.start();
  const stalled = client.request('never', {});
  const doomed = client.request('die', {});
  const results = await Promise.allSettled([stalled, doomed]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(client.ready, false);
});

test('malformed JSON and RPC timeouts fail the process instead of leaving work hanging', async t => {
  const broken = new CodexClient(process.execPath, [fixture]); t.after(() => broken.close());
  await broken.start();
  await assert.rejects(broken.request('malformed', {}));
  assert.equal(broken.ready, false);
  const stalled = new CodexClient(process.execPath, [fixture], 50); t.after(() => stalled.close());
  await stalled.start();
  await assert.rejects(stalled.request('never', {}), /timed out/);
  assert.equal(stalled.ready, false);
});
