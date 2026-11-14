import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Config } from '../src/config.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import type { DeliveryOptions, ContextPort } from '../src/types.js';
import { FakeCodex, until } from './helpers.js';
import { readJournal } from '../src/handoff/journal.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.ready = true; this.generation = randomUUID(); }
  async close() { this.exit(); }
}

function setup(t: TestContext, publish: () => Promise<void> = async () => {}, context?: ContextPort) {
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
  let interactions = new PilotInteractions(admission, config, { flush: publish }, native, sender, port, ['fixture-private-secret'], context);
  const actor = (text: string, overrides = {}) => ({ tenant: scope.tenant, user: scope.operator, chat: scope.chat, id: randomUUID(), text, chatType: 'p2p' as const, ...overrides });
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
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config, { flush: publish }, native, sender, port, ['fixture-private-secret'], context); await interactions.recover(); return interactions; };
  t.after(async () => { await native.stop(); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, admission, native, codex, sent, reactions, actor, launch, restart, get interactions() { return interactions; },
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
  const message = h.actor(' \t/批准 ' + token, { chat: 'admin', user: 'ou_admin' });
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

test('leading whitespace controls retain original receipts through native decisions and stop', async t => {
  const h = setup(t); const task = await h.launch();
  const status = h.actor(' \t/status');
  h.interactions.receive(status); await h.interactions.flush();
  assert.equal(h.admission.store.control(status)!.status, 'accepted');
  h.codex.ask('decline-whitespace', 'item/commandExecution/requestApproval', { threadId: task.thread, turnId: task.turn, command: 'echo fixture' });
  await drain(h);
  const prompt = h.sent.find(row => row.chat === 'admin' && row.text.includes('/拒绝'))!;
  const token = prompt.text.match(/请求 ([a-f0-9]{8})/)![1];
  const decision = h.actor(' /拒绝 ' + token, { chat: 'admin', user: 'ou_admin' });
  h.interactions.receive(decision); await drain(h);
  assert.equal(h.admission.store.control(decision)!.status, 'sent');
  assert.deepEqual(h.codex.replies, [{ id: 'decline-whitespace', result: { decision: 'decline' } }]);
  const saved = readJournal(join(h.admission.stateDirectory, 'executions', task.request.execution, 'bridge.db'), db =>
    db.prepare('SELECT message,status FROM relayed_controls WHERE origin=?').get(JSON.stringify([decision.tenant, decision.id])) as { message: string; status: string });
  assert.deepEqual(JSON.parse(saved.message), decision);
  assert.equal(saved.status, 'sent');
  assert.equal(h.interactions.receive({ ...decision, text: '/批准 ' + token }).status, 'duplicate');
  await drain(h); assert.equal(h.codex.replies.length, 1);
  const stop = h.actor('\n \t/stop');
  h.interactions.receive(stop); await task.running; await drain(h);
  assert.equal(h.admission.store.control(stop)!.status, 'stopping');
  assert.equal(h.admission.store.execution(task.request.execution)!.status, 'interrupted');
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

test('assigned group execution and quoted steering preserve scoped context and separate image inputs across gateway restart', async t => {
  const calls: { session: Parameters<ContextPort['context']>[0]; source: Parameters<ContextPort['context']>[1]; limit: number }[] = [];
  const h = setup(t, async () => {}, { context: async (session, source, limit) => {
    calls.push({ session, source, limit });
    return { status: 'available', messages: [{ sender: 'Member', type: 'image', text: source.parentId!, quoted: true }],
      note: 'Scoped references', images: [{ messageIndex: 0, label: 'Reference image', url: 'data:image/png;base64,aGVsbG8=' }] };
  } });
  h.config.enableGroups = true; h.config.groupContextMessages = 12; h.config.groupContextImages = 2;
  const message = h.actor('Inspect this reference', { chatType: 'group', createTime: 12345, parentId: 'initial-quote' });
  const admitted = h.interactions.receive(message); assert.ok('request' in admitted);
  await h.interactions.flush();
  await until(() => Boolean(h.admission.store.reference(admitted.request.execution, message)));
  await h.restart();
  const grant = h.admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  const input = h.codex.calls.find(call => call.method === 'turn/start')!.params.input as { type: string; text?: string; url?: string }[];
  assert.ok(input[0]!.text!.includes('initial-quote'));
  assert.ok(!input[0]!.text!.includes('base64'));
  assert.equal(input.find(item => item.type === 'image')!.url, 'data:image/png;base64,aGVsbG8=');
  assert.equal(calls.length, 1); assert.equal(calls[0]!.limit, 12);
  assert.equal(calls[0]!.session.chat, message.chat); assert.equal(calls[0]!.session.user, message.user);
  assert.equal(calls[0]!.source.id, message.id); assert.equal(calls[0]!.source.createTime, 12345);
  const supplement = h.actor(' \t/补充 Use this quoted detail', { chatType: 'group', createTime: 12346, parentId: 'steering-quote' });
  assert.equal(h.interactions.receive(supplement).status, 'control'); await h.interactions.flush();
  const steer = h.codex.calls.find(call => call.method === 'turn/steer')!.params.input as typeof input;
  assert.ok(steer[0]!.text!.includes('steering-quote')); assert.ok(steer.some(item => item.type === 'image'));
  assert.equal(calls[1]!.limit, 0); assert.equal(calls[1]!.source.id, supplement.id);
  h.codex.complete('thread-1', 'turn-2'); const report = await running; await drain(h);
  assert.equal(h.admission.store.reference(admitted.request.execution, message)!.context, null);
  assert.equal(h.admission.store.reference(admitted.request.execution, supplement)!.context, null);
  assert.equal((await h.native.run(grant.permit)).checkpoint, report.checkpoint);
});

test('a slow quoted group reference cannot block stop or steer a completed native turn', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fetching = false;
  const h = setup(t, async () => {}, { context: async () => { fetching = true; await gate; return { status: 'available', messages: [], note: 'Quote' }; } });
  h.config.enableGroups = true; const task = await h.launch();
  const supplement = h.actor('/补充 Read this quote', { chatType: 'group', parentId: 'slow-quote' });
  h.interactions.receive(supplement); await until(() => fetching);
  h.interactions.receive(h.actor('/stop'));
  await until(() => h.codex.calls.some(call => call.method === 'turn/interrupt'));
  release(); await task.running; await drain(h);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 0);
  assert.equal(h.admission.store.control(supplement)!.status, 'rejected');
});

test('sealed uncertain group execution retains its reference snapshot and project guard', async t => {
  const h = setup(t, async () => {}, { context: async () => ({ status: 'available', messages: [{ sender: 'Member', type: 'text', text: 'Retained quote', quoted: true }], note: 'Exact quote' }) });
  h.config.enableGroups = true;
  const message = h.actor('Inspect this quote', { chatType: 'group', parentId: 'retained-quote' });
  const admitted = h.interactions.receive(message); assert.ok('request' in admitted);
  await h.interactions.flush(); await until(() => Boolean(h.admission.store.reference(admitted.request.execution, message)));
  const grant = h.admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  h.codex.exit(); assert.equal((await running).outcome.status, 'unknown'); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 1);
  assert.equal(h.admission.store.reference(admitted.request.execution, message)!.context!.messages[0]!.text, 'Retained quote');
});

test('workspace gateway identifies its idle mode and explains task-based target selection', async t => {
  const h = setup(t); h.config.projectRouting = 'workspace';
  h.interactions.receive(h.actor('/status')); await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('当前：通用工作区')));
  const selection = h.actor('/project another-repository');
  h.interactions.receive(selection); h.interactions.receive(selection); await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === selection.id).length, 1);
  assert.ok(h.sent.some(row => row.text.includes('直接说明任务')));
  assert.equal(h.admission.store.requests().length, 0);
  assert.equal(h.codex.calls.length, 0);
});

async function unknownForRecovery(t: TestContext) {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch(); h.codex.exit();
  const report = await task.running; assert.equal(report.outcome.status, 'unknown'); await drain(h);
  return { h, task, report };
}

test('owner-private inspected recovery retains unknown, pause and blocked work without native replay', async t => {
  const { h, task, report } = await unknownForRecovery(t);
  const calls = h.codex.calls.length;
  h.interactions.receive(h.actor(' /status')); await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('/恢复 查看检查条件')));
  const inspect = h.actor(' \t/恢复'); assert.equal(h.interactions.receive(inspect).status, 'recovery'); await drain(h);
  const prompt = h.sent.find(row => row.options?.replyTo === inspect.id)!;
  assert.ok(prompt.text.includes(task.request.execution)); assert.ok(prompt.text.includes('后代进程'));
  assert.ok(!prompt.text.includes(task.request.input));
  const blocked = h.interactions.receive(h.actor('Do not replay this blocked request')); assert.ok('request' in blocked); assert.equal(blocked.status, 'blocked');
  h.admission.store.maintenance.quiesce();
  const confirm = h.actor('/恢复 ' + task.request.execution + ' fixture processes stopped; inspected file and external effects');
  assert.equal(h.interactions.receive(confirm).status, 'recovery'); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 0); assert.equal(h.admission.store.execution(task.request.execution)!.status, 'unknown');
  assert.equal(h.admission.store.maintenance.paused, true);
  const receipt = h.admission.store.recoveries()[0]!;
  assert.equal(receipt.actor, JSON.stringify(['tenant', 'ou_owner', 'chat']));
  assert.equal(receipt.origin, JSON.stringify(['tenant', confirm.id])); assert.ok(receipt.evidence.includes(report.checkpoint));
  assert.equal(h.admission.store.reserve(blocked.request.id, 2).kind, 'blocked');
  assert.equal(h.codex.calls.length, calls); assert.equal(h.codex.replies.length, 0);
  assert.ok(h.sent.some(row => row.options?.replyTo === confirm.id && row.text.includes('原任务仍为结果未确认')));
  h.admission.store.maintenance.resume();
  const fresh = h.interactions.receive(h.actor('Fresh authorized remaining work')); assert.ok('request' in fresh);
  assert.equal(h.admission.store.reserve(fresh.request.id, 3).kind, 'start');
  assert.equal(h.admission.store.conversationThread(fresh.request.conversation), task.thread);
  assert.equal(h.interactions.receive(confirm).status, 'duplicate');
  assert.equal(h.interactions.receive({ ...confirm, text: '/恢复 ' + fresh.request.execution + ' changed input' }).status, 'duplicate');
  h.interactions.receive(h.actor(confirm.text)); await drain(h);
  assert.equal(h.admission.store.unsettled()[0]!.id, fresh.request.execution);
  assert.equal(h.admission.store.recoveries().length, 1);
});

test('recovery excludes other users, tenants, chats, groups and non-administrator owners', async t => {
  const { h, task } = await unknownForRecovery(t); const count = h.sent.length;
  const text = '/恢复 ' + task.request.execution + ' fixture inspection';
  for (const fields of [{ user: 'ou_admin' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }]) {
    assert.equal(h.interactions.receive(h.actor(text, fields)).status, 'ignored');
  }
  h.config.approvalUsers = ['ou_admin']; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'other'; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.approvalChat = 'chat'; h.config.allowedUsers = []; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.allowedUsers = ['ou_owner'];
  assert.equal(h.interactions.receive(h.actor(text, { unsupported: true })).status, 'rejected');
  assert.equal(h.interactions.receive(h.actor('/恢复 ' + 'x'.repeat(30_000))).status, 'rejected');
  await drain(h); assert.equal(h.sent.length, count); assert.equal(h.admission.store.recoveries().length, 0);
  assert.equal(h.admission.store.unsettled().length, 1);
});

test('missing or mutated sealed evidence and empty inspection references leave the guard held', async t => {
  const { h, task } = await unknownForRecovery(t);
  const folder = join(h.admission.stateDirectory, 'executions', task.request.execution);
  for (const name of ['native-result.json', 'bridge.db']) {
    const path = join(folder, name), original = readFileSync(path);
    if (name === 'native-result.json') unlinkSync(path); else writeFileSync(path, Buffer.concat([original, Buffer.from('changed')]));
    h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' fixture inspection')); await drain(h);
    assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
    writeFileSync(path, original);
  }
  for (const suffix of ['', '   ', 'x'.repeat(1801)]) {
    h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' ' + suffix)); await drain(h);
    assert.equal(h.admission.store.recoveries().length, 0);
  }
  assert.ok(h.sent.some(row => row.text.includes('恢复条件尚未满足')));
});

test('an authenticated reachable native owner prevents remote recovery', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch(); h.admission.store.ownerUnconfirmed(task.request.execution);
  h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' fixture inspection')); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
});

test('unstarted admitted backlog prevents remote guard release', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch(); const queued = h.interactions.receive(h.actor('Already admitted next work')); assert.ok('request' in queued);
  h.codex.exit(); await task.running; await drain(h);
  h.interactions.receive(h.actor('/恢复')); await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('核对队列')));
  h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' fixture inspection')); await drain(h);
  assert.equal(h.admission.store.recoveries().length, 0); assert.equal(h.admission.store.unsettled().length, 1);
  assert.equal(h.admission.store.execution(queued.request.execution), undefined);
});

test('gateway restart repairs committed recovery notice once without repeating its decision', async t => {
  const { h, task } = await unknownForRecovery(t);
  const confirm = h.actor('/恢复 ' + task.request.execution + ' inspected fixture effects');
  h.interactions.receive(confirm); await until(() => h.admission.store.recoveries().length === 1);
  const original = h.interactions.transport.state.projectRecoveryNotice.bind(h.interactions.transport.state);
  let lost = true;
  h.interactions.transport.state.projectRecoveryNotice = (...args) => { if (lost) { lost = false; throw new Error('Gateway lost before notice projection'); } original(...args); };
  await assert.rejects(h.interactions.flush());
  assert.equal(h.admission.store.unsettled().length, 0);
  await h.restart(); await drain(h);
  const notices = h.sent.filter(row => row.options?.replyTo === confirm.id && row.text.includes('解除该任务'));
  assert.equal(notices.length, 1); assert.equal(h.admission.store.recoveries().length, 1);
  await h.restart(); await drain(h); assert.equal(h.sent.filter(row => row.options?.replyTo === confirm.id).length, 1);
  assert.equal(h.interactions.receive(confirm).status, 'duplicate');
});

test('uncommitted maintenance messages are not replayed on restart and task identities cannot become decisions', async t => {
  const { h, task } = await unknownForRecovery(t);
  const pending = h.actor('/恢复 ' + task.request.execution + ' inspected fixture effects');
  h.interactions.transport.state.remember(pending); // Crash after receipt, before any decision.
  await h.restart(); await drain(h);
  assert.equal(h.interactions.receive(pending).status, 'duplicate');
  assert.equal(h.admission.store.recoveries().length, 0); assert.equal(h.admission.store.unsettled().length, 1);
  h.interactions.receive({ ...task.message, text: pending.text }); await drain(h);
  assert.equal(h.admission.store.recoveries().length, 0); assert.equal(h.admission.store.unsettled().length, 1);
});

test('a concurrent inspected local recovery cannot let a remote decision release a newer guard', async t => {
  const { h, task } = await unknownForRecovery(t);
  const checkpoint = await h.native.recoveryCheckpoint(task.request.execution);
  let release!: () => void, checking = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  h.native.recoveryCheckpoint = async () => { checking = true; await gate; return checkpoint; };
  h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' inspected fixture effects'));
  await until(() => checking);
  h.admission.store.reconcileLocal('fixture-maintenance', task.request.execution, 'independent inspected recovery');
  const fresh = h.interactions.receive(h.actor('Fresh next work')); assert.ok('request' in fresh);
  assert.equal(h.admission.store.reserve(fresh.request.id, 2).kind, 'start');
  release(); await drain(h);
  assert.equal(h.admission.store.unsettled()[0]!.id, fresh.request.execution);
  assert.equal(h.admission.store.recoveries().length, 1);
  assert.equal(h.admission.store.recoveries()[0]!.actor, 'local-runtime-operator');
});

test('sealed recovery retains a native conversation when no earlier snapshot reached admission', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const snapshot = h.admission.store.nativeSnapshot.bind(h.admission.store);
  h.admission.store.nativeSnapshot = () => {}; // Simulate the owner checkpoint landing before any admission reference update.
  const task = await h.launch(); h.codex.exit(); await task.running; await drain(h);
  h.admission.store.nativeSnapshot = snapshot;
  assert.equal(h.admission.store.conversationThread(task.request.conversation), null);
  h.interactions.receive(h.actor('/恢复 ' + task.request.execution + ' inspected fixture processes and effects')); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 0);
  assert.equal(h.admission.store.conversationThread(task.request.conversation), task.thread);
});
