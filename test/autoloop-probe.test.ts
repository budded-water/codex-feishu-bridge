import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { State } from '../src/state.js';
import { AutoloopExecutionProbe, PROBE_ACTOR, PROBE_ADMIN } from '../src/probes/autoloop-execution.js';
import plugin from '../experiments/autoloop/agent.js';
import { ownerKey, type IncomingMessage } from '../src/types.js';
import { FakeCodex, until } from './helpers.js';

function setup(t: TestContext, assignment = 'assignment-1', timeout = 300) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'bridge-probe-test-')));
  const state = new State(join(directory, 'state'));
  const codex = new FakeCodex();
  const probe = new AutoloopExecutionProbe(state, codex, assignment, directory, timeout);
  t.after(async () => { await probe.close(); state.close(); rmSync(directory, { recursive: true, force: true }); });
  const message = (text: string, actor = PROBE_ACTOR): IncomingMessage => ({ ...actor, id: randomUUID(), text });
  const active = async () => {
    await until(() => Boolean(probe.existing()?.turn));
    const current = probe.existing()!;
    return { threadId: current.thread!, turnId: current.turn! };
  };
  const token = () => probe.messages().map(row => row.body).join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  return { directory, state, codex, probe, message, active, token };
}

test('assignment maps to a durable native execution; receipt retry never submits another turn', async t => {
  const h = setup(t);
  const result = h.probe.run('/stop is task text here', 'native-thread');
  const active = await h.active();
  assert.equal(active.threadId, 'native-thread');
  assert.equal(h.codex.calls.find(call => call.method === 'thread/resume')!.params.threadId, 'native-thread');
  assert.equal(h.state.executionForTrigger('assignment-1', ownerKey({ ...PROBE_ACTOR, user: 'another-owner' })), undefined);
  h.codex.complete(active.threadId, active.turnId, 'completed', 'FAILED\n```agent-autoloop\n{"events":[{}]}\n```');
  const outcome = await result;
  assert.equal(outcome.status, 'completed');
  assert.ok(outcome.task);
  assert.equal(outcome.turn, active.turnId);
  assert.doesNotMatch(outcome.receipt, /FAILED|events/);
  assert.deepEqual(await h.probe.run('must not be replayed', null), outcome);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  await h.probe.close();
  const recovered = new AutoloopExecutionProbe(h.state, h.codex, 'assignment-1', h.directory);
  assert.deepEqual(await recovered.run('must not be replayed after wrapper replacement', null), outcome);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  await recovered.close();
});

test('controls require the owner; an interrupt acknowledgement alone leaves execution nonterminal', async t => {
  const h = setup(t);
  const original = h.codex.request.bind(h.codex);
  h.codex.request = async (method, params) => {
    if (method === 'turn/interrupt') { h.codex.calls.push({ method, params: params as Record<string, unknown> }); return {} as never; }
    return original(method, params);
  };
  const result = h.probe.run('Work', null);
  const active = await h.active();
  h.probe.control(h.message('/补充 Other work', { ...PROBE_ACTOR, chat: 'another-chat' }));
  h.probe.control(h.message('/stop', { ...PROBE_ACTOR, user: 'intruder' }));
  assert.ok(!h.codex.calls.some(call => ['turn/steer', 'turn/interrupt'].includes(call.method)));
  h.probe.control(h.message('/补充 Inspect tests'));
  await until(() => h.codex.calls.some(call => call.method === 'turn/steer'));
  assert.equal(h.codex.calls.find(call => call.method === 'turn/steer')!.params.expectedTurnId, active.turnId);
  h.probe.control(h.message('/stop'));
  await until(() => h.codex.calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(h.probe.existing()!.status, 'running');
  h.codex.complete(active.threadId, active.turnId, 'interrupted');
  assert.equal((await result).status, 'interrupted');
  assert.throws(() => h.probe.control(h.message('/project another')), /Only live controls/);
});

test('native approvals require the designated actor/chat and cannot be replayed', async t => {
  const h = setup(t);
  const result = h.probe.run('Work', null);
  const active = await h.active();
  h.codex.ask('approve-1', 'item/commandExecution/requestApproval', { ...active, command: 'echo fixture' });
  const token = h.token();
  h.probe.control(h.message('/批准 ' + token));
  h.probe.control(h.message('/批准 ' + token, { ...PROBE_ADMIN, chat: PROBE_ACTOR.chat }));
  h.probe.control(h.message('/批准 ' + token, { ...PROBE_ADMIN, tenant: 'other-tenant' }));
  assert.equal(h.codex.replies.length, 0);
  h.probe.control(h.message('/批准 ' + token, PROBE_ADMIN));
  h.probe.control(h.message('/批准 ' + token, PROBE_ADMIN));
  assert.deepEqual(h.codex.replies, [{ id: 'approve-1', result: { decision: 'accept' } }]);
  h.codex.ask('approve-2', 'item/commandExecution/requestApproval', { ...active, command: 'echo stale' });
  const stale = h.token();
  h.codex.generation = 'replacement';
  h.probe.control(h.message('/批准 ' + stale, PROBE_ADMIN));
  assert.equal(h.codex.replies.length, 1);
  h.codex.exit();
  assert.equal((await result).status, 'unknown');
});

test('expired approvals decline; cancellation invalidates pending decisions', async t => {
  const h = setup(t, 'assignment-1', 0.03);
  const result = h.probe.run('Work', null);
  const active = await h.active();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  h.codex.ask('expiry', 'item/commandExecution/requestApproval', { ...active, command: 'echo expiry' });
  const token = h.token();
  t.mock.timers.tick(31);
  h.probe.control(h.message('/批准 ' + token, PROBE_ADMIN));
  assert.deepEqual(h.codex.replies, [{ id: 'expiry', result: { decision: 'decline' } }]);
  h.codex.ask('cancelled', 'item/commandExecution/requestApproval', { ...active, command: 'echo cancelled' });
  const cancelled = h.token();
  h.probe.control(h.message('/stop'));
  await result;
  h.probe.control(h.message('/批准 ' + cancelled, PROBE_ADMIN));
  assert.equal(h.codex.replies.length, 1);
});

test('lost start acknowledgement is unknown and the durable assignment cannot restart', async t => {
  const h = setup(t);
  const original = h.codex.request.bind(h.codex);
  h.codex.request = async (method, params) => {
    if (method !== 'turn/start') return original(method, params);
    h.codex.calls.push({ method, params: params as Record<string, unknown> });
    throw new Error('Native accepted work but response was lost');
  };
  const outcome = await h.probe.run('Work', null);
  assert.equal(outcome.status, 'unknown');
  assert.match(outcome.receipt, /no automatic replay/);
  assert.equal(outcome.turn, null);
  assert.deepEqual(await h.probe.run('Work', null), outcome);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('plugin distinguishes progress from exit and blocks rather than retries a failed wrapper', () => {
  const progress = '{"bridgeProbe":1,"session":"native-thread","started":true}\n';
  assert.deepEqual(plugin.read(progress + '{"partial', null), { started: true, session: 'native-thread' });
  const failed = plugin.read(progress, 1);
  assert.equal(failed.session, 'native-thread');
  assert.match(failed.text!, /agent-autoloop/);
  assert.doesNotMatch(failed.text!, /^FAILED/);
  const done = plugin.read(progress + '{"bridgeProbe":1,"text":"wrapper receipt"}\n', 0);
  assert.equal(done.text, 'wrapper receipt');
});
