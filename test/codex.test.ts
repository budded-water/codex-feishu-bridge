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


test('closing during version validation cannot resurrect a Codex subprocess', async t => {
  const client = new CodexClient(process.execPath, [fixture]); t.after(() => client.close());
  const startup = client.start();
  await client.close();
  await assert.rejects(startup, /startup was interrupted/);
  assert.equal(client.ready, false);
  // The cancelled start must not poison an explicitly requested later start.
  await client.start(); assert.equal(client.ready, true);
});


test('bot effort overrides new turns on execution and routing threads, including resumed threads and process restarts', async t => {
  const client = new CodexClient(process.execPath, [fixture], 30_000, 'low');
  t.after(() => client.close());
  await client.start();
  const input = [{ type: 'text', text: 'Task', text_elements: [] }];
  for (const threadId of ['execution', 'router']) {
    const resume = { threadId, cwd: '/test', excludeTurns: true };
    assert.deepEqual(await client.request('thread/resume', resume), resume);
    const params = { threadId, input, effort: 'high', cwd: '/test' };
    assert.deepEqual(await client.request('turn/start', params), { ...params, effort: 'low' });
    assert.equal(params.effort, 'high');
    const followup = { threadId, input };
    assert.deepEqual(await client.request('turn/start', followup), { ...followup, effort: 'low' });
    assert.deepEqual(await client.request('turn/steer', followup), followup);
  }
  await client.close(); await client.start();
  assert.deepEqual(await client.request('turn/start', { threadId: 'execution', input }), { threadId: 'execution', input, effort: 'low' });
});

test('omitted or null bot effort preserves inherited and caller settings', async t => {
  for (const effort of [undefined, null] as const) {
    const client = new CodexClient(process.execPath, [fixture], 30_000, effort);
    t.after(() => client.close());
    await client.start();
    for (const params of [{ threadId: 'execution', input: [] }, { threadId: 'execution', input: [], effort: 'high' }]) {
      assert.deepEqual(await client.request('turn/start', params), params);
    }
    await client.close();
  }
});
