import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Config } from '../src/config.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import type { DeliveryOptions } from '../src/types.js';
import { FakeCodex, until } from './helpers.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.generation = randomUUID(); }
  async close() { this.exit(); }
}

function setup(t: TestContext, publish: () => Promise<void> = async () => {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-interactions-')));
  const project = join(root, 'project'); mkdirSync(project);
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: project },
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { allowedUsers: ['ou_owner', 'ou_admin'], accessMode: 'allowlist', allowedTenant: 'tenant', enableGroups: false,
    groupContextMessages: 0, groupContextImages: 0, approvalUsers: ['ou_admin'], approvalChat: 'admin', codexExecutable: 'codex',
    stateDirectory: join(root, 'state'), approvalTimeoutSeconds: 300, projects: scope.projects, projectRouting: 'manual' };
  const admission = new PilotAdmission(config.stateDirectory, scope);
  const codex = new ManagedFake();
  const native = new NativeExecutions(admission, config, () => codex);
  const sent: { chat: string; text: string; id: string; options?: DeliveryOptions }[] = [];
  const reactions = new Map<string, string>();
  let send = async (chat: string, text: string, id: string, options?: DeliveryOptions): Promise<string> => {
    sent.push({ chat, text, id, options }); return 'delivered-' + id;
  };
  let remove = async (message: string) => { reactions.delete(message); };
  const sender = { send: (chat: string, text: string, id: string, options?: DeliveryOptions) => send(chat, text, id, options) };
  const port = { addReaction: async (message: string) => { const id = 'reaction-' + message; reactions.set(message, id); return id; },
    findReaction: async (message: string) => reactions.get(message), removeReaction: (message: string) => remove(message) };
  let interactions = new PilotInteractions(admission, config, { flush: publish }, native, sender, port, ['fixture-private-secret']);
  const actor = (text: string, overrides = {}) => ({ tenant: scope.tenant, user: scope.operator, chat: scope.chat, id: randomUUID(), text, ...overrides });
  const launch = async () => {
    const message = actor('Inspect this assigned task');
    const admitted = interactions.receive(message); assert.ok('request' in admitted);
    await interactions.flush();
    assert.ok(reactions.has(message.id));
    const grant = admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start');
    if (grant.kind !== 'start') throw new Error('Missing grant');
    const running = native.run(grant.permit);
    await until(() => codex.calls.some(call => call.method === 'turn/start'));
    const call = codex.calls.find(call => call.method === 'turn/start')!;
    const thread = String(call.params.threadId), turn = 'turn-2';
    return { message, request: admitted.request, running, thread, turn };
  };
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config, { flush: publish }, native, sender, port, ['fixture-private-secret']); await interactions.recover(); return interactions; };
  t.after(async () => { await native.stop(); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { admission, native, codex, sent, reactions, actor, launch, restart, get interactions() { return interactions; },
    setSend: (value: typeof send) => { send = value; }, setRemove: (value: typeof remove) => { remove = value; } };
}

async function drain(h: ReturnType<typeof setup>) { for (let i = 0; i < 12; i++) await h.interactions.flush(); }

test('lost control acknowledgement is lookup-only and gateway restart retains original execution and actor', async t => {
  const h = setup(t); const task = await h.launch();
  h.interactions.receive(h.actor('/status')); await h.interactions.flush();
  assert.ok(h.sent.some(row => row.text.includes('当前项目：pilot')));
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw new Error('Acknowledgement lost'); };
  const message = h.actor('/补充 保留中文 👩🏽‍💻\n  indented', { parentId: task.message.id });
  assert.equal(h.interactions.receive(message).status, 'control');
  await h.interactions.flush();
  assert.ok(['unknown', 'accepted'].includes(h.admission.store.control(message)!.status));
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  assert.deepEqual(h.codex.calls.find(call => call.method === 'turn/steer')!.params.input, [{ type: 'text', text: '保留中文 👩🏽‍💻\n  indented', text_elements: [] }]);
  await h.restart(); await h.interactions.flush();
  assert.equal(h.admission.store.control(message)!.status, 'accepted');
  assert.equal(h.interactions.receive({ ...message, text: '/stop' }).status, 'duplicate');
  assert.equal(h.interactions.receive(h.actor('/stop', { user: 'ou_intruder' })).status, 'ignored');
  assert.equal(h.interactions.receive(h.actor('/stop', { parentId: 'another-users-message' })).status, 'rejected');
  await h.interactions.flush();
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  assert.ok(!h.codex.calls.some(call => call.method === 'turn/interrupt'));
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('Done') && row.options?.replyTo === task.message.id));
  assert.equal(h.reactions.has(task.message.id), false);
});

test('native approvals and expired prompts are never replayed after acknowledgement loss', async t => {
  const h = setup(t); const task = await h.launch();
  h.codex.ask('approval', 'item/commandExecution/requestApproval', { threadId: task.thread, turnId: task.turn, command: 'echo fixture' });
  await drain(h);
  const prompt = h.sent.find(row => row.chat === 'admin' && row.text.includes('/批准'))!;
  const token = prompt.text.match(/请求 ([a-f0-9]{8})/)![1];
  assert.equal(h.interactions.receive(h.actor('/批准 ' + token, { chat: 'admin', user: 'ou_intruder' })).status, 'ignored');
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw new Error('Lost approval acknowledgement'); };
  const message = h.actor('/批准 ' + token, { chat: 'admin', user: 'ou_admin' });
  h.interactions.receive(message); await h.interactions.flush();
  assert.equal(h.codex.replies.length, 1);
  await h.restart(); await drain(h);
  assert.equal(h.admission.store.control(message)!.status, 'sent');
  assert.equal(h.codex.replies.length, 1);
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
  const late = h.actor('/批准 ' + token, { chat: 'admin', user: 'ou_admin' });
  assert.equal(h.interactions.receive(late).status, 'rejected');
  assert.equal(h.codex.replies.length, 1);
});

test('uncertain dispatch with no native record never retries its approval', async t => {
  const h = setup(t); const task = await h.launch();
  const message = h.actor('/批准 absent', { chat: 'admin', user: 'ou_admin' });
  h.interactions.receive(message);
  let attempts = 0;
  h.native.relay = async () => { attempts++; throw new Error('No confirmed native receipt'); };
  await h.interactions.flush(); await h.restart(); await drain(h);
  assert.equal(attempts, 1);
  assert.equal(h.admission.store.control(message)!.status, 'unknown');
  assert.equal(h.codex.replies.length, 0);
  h.codex.complete(task.thread, task.turn); await task.running;
});

test('sealed final delivery survives gateway outage, retries with the same UUID and independently cleans reactions', async t => {
  const h = setup(t); const task = await h.launch();
  await h.interactions.close();
  h.codex.complete(task.thread, task.turn, 'completed', 'Verified fixture-private-secret final result');
  const report = await task.running;
  await h.restart();
  const attempts: string[] = [];
  h.setSend(async (_chat, text, id) => { if (text.includes('final result')) { attempts.push(id); throw new Error('Transport acknowledgement lost'); } return 'message'; });
  await h.interactions.flush();
  assert.equal(h.reactions.has(task.message.id), false);
  assert.equal(attempts.length, 1);
  await h.restart();
  h.setSend(async (chat, text, id, options) => { attempts.push(id); h.sent.push({ chat, text, id, options }); return 'reply-' + id; });
  // Advance only delivery retry eligibility; native history stays untouched.
  const pending = h.interactions.transport.state.pending(Number.MAX_SAFE_INTEGER);
  assert.equal(pending.length, 1);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 120_000 });
  await drain(h);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(h.sent.filter(row => row.text.includes('final result')).length, 1);
  assert.ok(!h.sent.some(row => row.text.includes('fixture-private-secret')));
  assert.equal(h.interactions.transport.state.referencedTask('reply-' + attempts[1], JSON.stringify(['tenant', 'ou_owner', 'chat'])), task.request.execution);
  assert.equal(h.native.evidence(task.request.execution).databaseHash, report.databaseHash);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('a prompt that expires while another chat is sending is suppressed at the native boundary', async t => {
  const h = setup(t); const task = await h.launch();
  h.codex.ask('approval', 'item/commandExecution/requestApproval', { threadId: task.thread, turnId: task.turn, command: 'echo fixture' });
  h.interactions.transport.state.send('chat', 'Fixture blocking reply');
  await h.interactions.transport.sync();
  // Queue an unrelated local reply first, then make its network request slow.
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  h.setSend(async (chat, text, id, options) => {
    if (first) { first = false; await gate; }
    h.sent.push({ chat, text, id, options }); return 'reply';
  });
  const flushing = h.interactions.transport.flush();
  await until(() => !first);
  h.codex.complete(task.thread, task.turn); await task.running;
  release(); await flushing; await drain(h);
  assert.ok(!h.sent.some(row => row.chat === 'admin' && row.text.includes('/批准')));
});

test('polling a newly reserved assignment does not revoke its launch window', async t => {
  const h = setup(t);
  const admitted = h.interactions.receive(h.actor('New assignment')); assert.ok('request' in admitted);
  const grant = h.admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  await h.interactions.flush();
  assert.equal(h.admission.store.execution(grant.permit.execution)!.status, 'active');
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  const call = h.codex.calls.find(call => call.method === 'turn/start')!;
  h.codex.complete(String(call.params.threadId), 'turn-2');
  await running;
});

test('an in-flight native control stays unconfirmed until its RPC acknowledges', async t => {
  const h = setup(t); const task = await h.launch();
  const request = h.codex.request.bind(h.codex);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = request<T>(method, params);
    if (method === 'turn/steer') await gate;
    return result;
  };
  const message = h.actor('/补充 Continue only after this constraint');
  h.interactions.receive(message); await h.interactions.flush();
  assert.equal(h.admission.store.control(message)!.status, 'unknown');
  assert.ok(!h.sent.some(row => row.text.includes('已把补充要求传给当前任务')));
  await h.interactions.flush();
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  release();
  await new Promise(resolve => setImmediate(resolve)); await drain(h);
  assert.equal(h.admission.store.control(message)!.status, 'accepted');
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('已把补充要求传给当前任务')));
});

test('a stop racing completed work preserves the observed completed outcome', async t => {
  const h = setup(t); const task = await h.launch();
  const request = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/interrupt') {
      h.codex.complete(task.thread, task.turn, 'completed', 'Finished before stop');
      return {} as T;
    }
    return request<T>(method, params);
  };
  const message = h.actor('/stop'); h.interactions.receive(message);
  await h.interactions.flush(); await task.running; await drain(h);
  assert.equal(h.native.evidence(task.request.execution).outcome.status, 'completed');
  assert.ok(h.sent.some(row => row.text === 'Finished before stop'));
  assert.ok(!h.sent.some(row => row.text.includes('已停止当前')));
});

test('reaction removal failure survives a restart without repeating the final answer', async t => {
  const h = setup(t); const task = await h.launch();
  h.setRemove(async () => { throw new Error('Reaction removal unavailable'); });
  h.codex.complete(task.thread, task.turn, 'completed', 'One final answer'); await task.running;
  await drain(h);
  assert.ok(h.reactions.has(task.message.id));
  assert.equal(h.sent.filter(row => row.text === 'One final answer').length, 1);
  await h.restart();
  h.setRemove(async message => { h.reactions.delete(message); });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 120_000 });
  await drain(h);
  assert.equal(h.reactions.size, 0);
  assert.equal(h.sent.filter(row => row.text === 'One final answer').length, 1);
});

test('a stale native generation cannot dispatch a control and dispatch records survive final sealing', async t => {
  const h = setup(t); const task = await h.launch();
  const message = h.actor('/补充 Stale generation');
  const rejected = await h.native.relay(task.request.execution, message, { generation: 'stale', thread: task.thread, turn: task.turn });
  assert.equal(rejected, 'rejected');
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 0);
  h.codex.complete(task.thread, task.turn); await task.running;
  assert.equal(await h.native.controlResult(task.request.execution, message), 'rejected');
});

test('an unrouted source request removes its receipt reaction and reports that it never started', async t => {
  const h = setup(t);
  const message = h.actor('A request that cannot be routed');
  const result = h.interactions.receive(message); assert.ok('request' in result);
  await h.interactions.flush(); assert.ok(h.reactions.has(message.id));
  h.admission.store.routed(result.request.id, false);
  await drain(h); await h.restart(); await drain(h);
  assert.equal(h.reactions.has(message.id), false);
  assert.equal(h.sent.filter(row => row.text.includes('没有进入预期的调度规则')).length, 1);
  assert.equal(h.codex.calls.length, 0);
});

test('a settled pre-start cancellation still produces truthful human feedback', async t => {
  const h = setup(t);
  const result = h.interactions.receive(h.actor('Not started')); assert.ok('request' in result);
  const grant = h.admission.store.reserve(result.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  await h.native.stop();
  assert.equal((await h.native.run(grant.permit)).outcome.status, 'interrupted');
  await drain(h);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 0);
  assert.equal(h.sent.filter(row => row.text.includes('没有启动模型任务')).length, 1);
});

test('a stalled source publisher does not block controls for the active native execution', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const h = setup(t, () => gate);
  try {
    const task = await h.launch();
    const message = h.actor('/补充 This control bypasses source publication');
    h.interactions.receive(message); await h.interactions.flush();
    assert.equal(h.admission.store.control(message)!.status, 'accepted');
    assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
    h.codex.complete(task.thread, task.turn); await task.running;
  } finally { release(); }
});

test('a slow human send cannot delay a newly admitted live control', async t => {
  const h = setup(t); const task = await h.launch();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sending = false;
  h.interactions.transport.state.send('chat', 'Slow human transport');
  h.setSend(async () => { sending = true; await gate; return 'reply'; });
  const flushing = h.interactions.flush();
  try {
    await until(() => sending);
    const message = h.actor('/补充 Apply this before the human delivery finishes');
    h.interactions.receive(message);
    await until(() => h.admission.store.control(message)!.status === 'accepted');
    assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  } finally { release(); await flushing; }
  h.codex.complete(task.thread, task.turn); await task.running;
});
