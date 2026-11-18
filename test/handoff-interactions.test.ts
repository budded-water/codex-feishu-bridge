import { DatabaseSync } from 'node:sqlite';
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
import { ownerKey, type DeliveryOptions, type ContextPort } from '../src/types.js';
import { SteerTargetEnded } from '../src/codex/client.js';
import { FakeCodex, until } from './helpers.js';
import { readJournal } from '../src/handoff/journal.js';
import { matterCard, normalizeMatterClick } from '../src/matter-card.js';
import type { ApprovalClick, ApprovalView, ApprovalPresentation } from '../src/approval.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.ready = true; this.generation = randomUUID(); }
  async close() { this.exit(); }
}

function setup(t: TestContext, publish: () => Promise<void> = async () => {}, context?: ContextPort, extraProjects: string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-interactions-')));
  const project = join(root, 'project'); mkdirSync(project);
  const projects = { pilot: project, ...Object.fromEntries(extraProjects.map(name => {
    const directory = join(root, name); mkdirSync(directory);
    return [name, directory];
  })) };
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects,
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { allowedUsers: ['ou_owner', 'ou_admin'], accessMode: 'allowlist', allowedTenant: 'tenant', enableGroups: false,
    groupContextMessages: 0, groupContextImages: 0, approvalUsers: ['ou_admin'], approvalChat: 'admin', codexExecutable: 'codex',
    stateDirectory: join(root, 'state'), approvalTimeoutSeconds: 300, projects: scope.projects, projectRouting: 'manual' };
  const admission = new PilotAdmission(config.stateDirectory, scope);
  const codex = new ManagedFake();
  const native = new NativeExecutions(admission, config, () => codex);
  const sent: { chat: string; text: string; id: string; options?: DeliveryOptions }[] = [];
  const reactions = new Map<string, string>();
  let send = async (chat: string, text: string, id: string, options?: DeliveryOptions): Promise<string | void> => {
    assert.ok(!options?.replyTo?.startsWith('card/'), 'Feishu cannot reply to a synthetic event ID');
    sent.push({ chat, text, id, options }); return 'delivered-' + id;
  };
  let remove = async (message: string) => { reactions.delete(message); };
  const cardUpdates: { message: string; view: ApprovalView; approval: ApprovalPresentation }[] = [];
  const sender = { send: (chat: string, text: string, id: string, options?: DeliveryOptions) => send(chat, text, id, options),
    updateApproval: async (message: string, approval: ApprovalPresentation, view: ApprovalView) => { cardUpdates.push({ message, view, approval }); } };
  const port = { addReaction: async (message: string) => { const id = 'reaction-' + message; reactions.set(message, id); return id; },
    findReaction: async (message: string) => reactions.get(message), removeReaction: (message: string) => remove(message) };
  let interactions = new PilotInteractions(admission, config, { flush: publish, diagnose: async () => ({ status: 'unavailable' }) }, native, sender, port, ['fixture-private-secret'], context);
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
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config, { flush: publish, diagnose: async () => ({ status: 'unavailable' }) }, native, sender, port, ['fixture-private-secret'], context); await interactions.recover(); return interactions; };
  t.after(async () => { await native.stop(); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, admission, native, codex, sent, cardUpdates, reactions, actor, launch, restart, get interactions() { return interactions; },
    setSend: (value: typeof send) => { send = value; }, setRemove: (value: typeof remove) => { remove = value; } };
}

async function drain(h: ReturnType<typeof setup>) { for (let i = 0; i < 12; i++) await h.interactions.flush(); }

test('plain owner replies merge into the referenced queued request once and reach the eventual native turn', async t => {
  const h = setup(t);
  const original = h.actor('Inspect the release');
  const admitted = h.interactions.receive(original);
  assert.ok('request' in admitted);
  const unrelated = h.interactions.receive(h.actor('Independently check the staging site'));
  assert.ok('request' in unrelated);
  const first = h.actor('Also look at CI', { parentId: original.id });
  const second = h.actor('只看后端', { parentId: original.id });
  assert.equal(h.interactions.receive(first).status, 'task-reply');
  assert.equal(h.interactions.receive(second).status, 'task-reply');
  await h.restart();
  assert.equal(h.interactions.receive(first).status, 'ignored');
  assert.equal(h.admission.store.requests().length, 2);
  assert.equal(h.admission.store.request(unrelated.request.id)!.input, 'Independently check the staging site');
  await drain(h);
  for (const reply of [first, second]) {
    assert.equal(h.sent.filter(row => row.options?.replyTo === reply.id && row.text.includes('已补到原任务')).length, 1);
  }
  const reserved = h.admission.store.reserve(admitted.request.id, 10);
  assert.equal(reserved.kind, 'start');
  if (reserved.kind !== 'start') throw Error('Expected reservation');
  const running = h.native.run(reserved.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  const start = h.codex.calls.find(call => call.method === 'turn/start')!;
  assert.deepEqual(start.params.input, [{ type: 'text', text: 'Inspect the release\n\n用户补充要求：\nAlso look at CI\n\n用户补充要求：\n只看后端', text_elements: [] }]);
  assert.equal(h.admission.store.assignmentRuns(admitted.request.id).length, 1);
  h.codex.complete(String(start.params.threadId), 'turn-2');
  await running;
});

test('a reply after Worker reservation waits for the original native turn rather than rewriting input or starting another task', async t => {
  const h = setup(t);
  const message = h.actor('Begin the original task');
  const admitted = h.interactions.receive(message);
  assert.ok('request' in admitted);
  const worker = new PilotAdmission(h.config.stateDirectory, h.admission.scope);
  let grant;
  try { grant = worker.store.reserve(admitted.request.id, 41); }
  finally { worker.close(); }
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected reservation');
  const reply = h.actor('Include CI', { parentId: message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  await drain(h);
  assert.equal(h.admission.store.control(reply)?.status, 'received');
  assert.equal(h.admission.store.request(admitted.request.id)?.input, message.text);
  assert.equal(h.admission.store.requests().length, 1);
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  await drain(h);
  const start = h.codex.calls.find(call => call.method === 'turn/start')!;
  const steers = h.codex.calls.filter(call => call.method === 'turn/steer');
  assert.equal(steers.length, 1);
  assert.equal(steers[0]!.params.threadId, start.params.threadId);
  assert.equal(steers[0]!.params.expectedTurnId, 'turn-2');
  h.codex.complete(String(start.params.threadId), 'turn-2');
  await running;
});

test('a plain reply to the active task uses the exact native turn and survives lost acknowledgement without another task', async t => {
  const h = setup(t);
  const task = await h.launch();
  const another = h.interactions.receive(h.actor('Do separate work without a reply'));
  assert.ok('request' in another);
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw Error('Response lost after dispatch'); };
  const reply = h.actor('Also check the CI conclusion', { parentId: task.message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  await drain(h);
  h.codex.complete(task.thread, task.turn);
  await task.running;
  await h.restart();
  await drain(h);
  const steers = h.codex.calls.filter(call => call.method === 'turn/steer');
  assert.equal(steers.length, 1);
  assert.equal(steers[0]!.params.threadId, task.thread);
  assert.equal(steers[0]!.params.expectedTurnId, task.turn);
  assert.deepEqual(steers[0]!.params.input, [{ type: 'text', text: 'Also check the CI conclusion', text_elements: [] }]);
  assert.equal(h.admission.store.control(reply)!.status, 'accepted');
  assert.equal(h.admission.store.requests().length, 2);
  assert.equal(h.sent.filter(row => row.options?.replyTo === reply.id && row.text.includes('已把补充要求传给当前任务')).length, 1);
  assert.ok(!h.sent.some(row => row.options?.replyTo === reply.id && row.text.includes('后续追问')));
});

test('a reply to an ended task queues a linked follow-up in the same thread and preserves the original native journal', async t => {
  const h = setup(t);
  const task = await h.launch();
  h.codex.complete(task.thread, task.turn);
  await task.running;
  await drain(h);
  const final = h.sent.find(row => row.options?.replyTo === task.message.id && row.text.includes('Done'))!;
  assert.ok(final);
  const journal = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db');
  const original = readFileSync(journal);
  const reply = h.actor('Explain why', { parentId: task.message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  assert.equal(h.interactions.receive(reply).status, 'ignored');
  const [initial, followup] = h.admission.store.requests();
  assert.equal(initial!.input, task.request.input);
  assert.equal(followup!.conversation, initial!.conversation);
  assert.match(followup!.input, /本次用户追问：\nExplain why/);
  const record = h.admission.store.taskReply(JSON.stringify([reply.tenant, reply.id]))!;
  assert.equal(record.request, initial!.id);
  assert.equal(record.followup, followup!.id);
  await h.restart();
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === reply.id && row.text.includes('已排为原会话的后续追问')).length, 1);
  assert.deepEqual(readFileSync(journal), original);
  const reservation = h.admission.store.reserve(followup!.id, 11);
  assert.equal(reservation.kind, 'start');
  if (reservation.kind !== 'start') throw Error('Expected follow-up reservation');
  const running = h.native.run(reservation.permit);
  await until(() => h.codex.calls.filter(call => call.method === 'turn/start').length === 2);
  assert.equal(h.codex.calls.find(call => call.method === 'thread/resume')?.params.threadId, task.thread);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').at(-1)!.params.threadId, task.thread);
  await h.native.stop();
  await running;
});

test('a reply that misses its active turn becomes a follow-up only after definite rejection and settlement', async t => {
  const h = setup(t);
  const task = await h.launch();
  const nativeRequest = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = await nativeRequest<T>(method, params);
    if (method === 'turn/steer') {
      h.codex.complete(task.thread, task.turn);
      throw new SteerTargetEnded();
    }
    return result;
  };
  const reply = h.actor('Also tell me what is left', { parentId: task.message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  await drain(h);
  await task.running;
  await drain(h);
  assert.equal(h.admission.store.control(reply)?.status, 'rejected');
  assert.equal(h.admission.store.requests().length, 2);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  await h.restart();
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === reply.id && row.text.includes('后续追问')).length, 1);
  assert.equal(h.admission.store.requests().length, 2);
});

test('a queued follow-up does not use a different native conversation if the thread changed before assignment', async t => {
  const h = setup(t);
  const task = await h.launch();
  h.codex.complete(task.thread, task.turn);
  await task.running;
  const reply = h.actor('Why?', { parentId: task.message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  const followup = h.admission.store.requests().at(-1)!;
  const next = h.interactions.receive(h.actor('Independent new task'));
  assert.ok('request' in next);
  const importRun = h.admission.store.reserve(next.request.id, 2);
  assert.equal(importRun.kind, 'start');
  if (importRun.kind !== 'start') throw Error('Expected an intervening reservation');
  h.admission.store.nativeSnapshot(importRun.permit, { thread: 'replacement-thread', turn: 'new-turn', generation: 'new-generation' });
  h.admission.terminal(importRun.permit, { status: 'completed', processSettled: true, reference: 'fixture/checkpoint' });
  assert.equal(h.admission.store.reserve(followup.id, 3).kind, 'blocked');
  assert.equal(h.admission.store.execution(followup.execution), undefined);
  await h.restart();
  await drain(h);
  assert.equal(h.admission.store.execution(followup.execution), undefined);
  assert.equal(h.sent.filter(row => row.options?.replyTo === reply.id && row.text.includes('会话在等待期间发生变化')).length, 1);
});

test('a quoted reply with possibly applied effects remains lookup-only after original completion', async t => {
  const h = setup(t);
  const task = await h.launch();
  const request = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = await request<T>(method, params);
    if (method === 'turn/steer') throw Error('Codex did not confirm whether the input was applied');
    return result;
  };
  const reply = h.actor('One more detail', { parentId: task.message.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  await drain(h);
  h.codex.complete(task.thread, task.turn);
  await task.running;
  await h.restart();
  await drain(h);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 1);
  assert.equal(h.admission.store.requests().length, 1);
  assert.equal(h.admission.store.control(reply)?.status, 'unknown');
  assert.ok(h.sent.some(row => row.options?.replyTo === reply.id && row.text.includes('未确认成功')));
});

test('a private quote respects owner, chat, explicit commands, withdrawal and unmatched references', async t => {
  const h = setup(t);
  h.config.approvalUsers = ['ou_owner'];
  h.config.approvalChat = 'chat';
  const original = h.actor('Do the planned task');
  const admitted = h.interactions.receive(original);
  assert.ok('request' in admitted);
  for (const actor of [{ user: 'ou_intruder' }, { tenant: 'other' }, { chat: 'other-chat' }]) {
    assert.equal(h.interactions.receive(h.actor('Different actor', { parentId: original.id, ...actor })).status, 'ignored');
  }
  assert.equal(h.interactions.receive(h.actor('/queue', { parentId: original.id })).status, 'queue');
  assert.equal(h.interactions.receive(h.actor('/withdraw', { parentId: original.id })).status, 'withdrawn');
  const reply = h.actor('Please add CI', { parentId: original.id });
  assert.equal(h.interactions.receive(reply).status, 'task-reply');
  assert.equal(h.admission.store.requests().length, 1);
  assert.equal(h.admission.store.request(admitted.request.id)!.input, original.text);
  assert.equal(h.interactions.receive(h.actor('Ordinary message with an unrelated quote', { parentId: 'unknown-original' })).status, 'accepted');
  await drain(h);
  assert.ok(h.sent.some(row => row.options?.replyTo === reply.id && row.text.includes('无法接收补充')));
});

test('private card callbacks preserve delivered identity and original native target through lost IPC acknowledgment and restart', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch();
  h.codex.ask('card-native', 'item/commandExecution/requestApproval', { threadId: task.thread, turnId: task.turn, command: 'echo bounded-card' });
  await drain(h);
  const delivered = h.sent.find(row => row.options?.approval)!; assert.ok(delivered);
  const p = delivered.options!.approval!;
  const click: ApprovalClick = { event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'delivered-' + delivered.id, id: p.id, decision: 'approve' };
  for (const change of [{ user: 'ou_admin' }, { tenant: 'other' }, { chat: 'admin' }, { message: 'another-card' }]) assert.equal(h.interactions.cardAction({ ...click, ...change }), 'rejected');
  let relayCount = 0; const relay = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { relayCount++; await relay(...args); throw Error('ack lost'); };
  assert.equal(h.interactions.cardAction(click), 'accepted');
  const command = { ...h.actor('/approve ' + p.prompt), id: 'card/' + click.event };
  assert.deepEqual(h.admission.store.control(command)!.target, p.target);
  assert.equal(h.interactions.cardAction(click), 'duplicate');
  await drain(h); await h.restart(); await drain(h);
  assert.equal(relayCount, 1); assert.deepEqual(h.codex.replies, [{ id: 'card-native', result: { decision: 'accept' } }]);
  assert.equal(h.admission.store.control(command)!.status, 'sent');
  assert.deepEqual(h.cardUpdates.map(({ message, view }) => ({ message, view })), [{ message: click.message, view: 'approved' }]);
  assert.ok(h.sent.some(row => row.text.includes('已批准这一步') && row.options?.replyTo === click.message));
  assert.equal(h.interactions.cardAction({ ...click, event: randomUUID(), decision: 'reject' }), 'rejected');
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('native card projection redacts transport secrets in sends and updates without changing the sealed journal', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch();
  h.codex.ask('private-card', 'item/commandExecution/requestApproval', { threadId: task.thread, turnId: task.turn,
    command: 'echo fixture-private-secret', reason: 'Inspect fixture-private-secret' });
  const source = await h.native.projection(task.request.execution);
  const p = source.messages.find(row => row.approval)!.approval!; assert.ok(p.action.includes('fixture-private-secret'));
  await drain(h);
  const sent = h.sent.find(row => row.options?.approval)!; assert.ok(sent);
  assert.ok(!JSON.stringify(sent).includes('fixture-private-secret')); assert.equal(sent.options!.approval!.id, p.id);
  const click: ApprovalClick = { event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'delivered-' + sent.id, id: p.id, decision: 'reject' };
  assert.equal(h.interactions.cardAction(click), 'accepted'); await drain(h);
  assert.equal(h.cardUpdates.length, 1); assert.ok(!JSON.stringify(h.cardUpdates).includes('fixture-private-secret'));
  h.codex.complete(task.thread, task.turn); await task.running;
  const path = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db'); const before = readFileSync(path);
  await drain(h); assert.deepEqual(readFileSync(path), before); assert.equal(h.codex.replies.length, 1);
  assert.ok(h.sent.some(row => row.text.includes('Done'))); assert.equal(h.interactions.transport.state.drainStatus().outbox, 0);
});

test('lost control acknowledgement is lookup-only and gateway restart retains original execution and actor', async t => {
  const h = setup(t); const task = await h.launch();
  h.interactions.receive(h.actor('/status')); await h.interactions.flush();
  assert.ok(h.sent.some(row => row.text.includes('当前项目：pilot')));
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw new Error('Acknowledgement lost'); };
  const message = h.actor('/steer 保留中文 👩🏽‍💻\n  indented', { parentId: task.message.id });
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
  const prompt = h.sent.find(row => row.chat === 'admin' && row.text.includes('/approve'))!;
  const token = prompt.text.match(/请求 ([a-f0-9]{8})/)![1];
  assert.equal(h.interactions.receive(h.actor('/approve ' + token, { chat: 'admin', user: 'ou_intruder' })).status, 'ignored');
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw new Error('Lost approval acknowledgement'); };
  const message = h.actor(' \t/approve ' + token, { chat: 'admin', user: 'ou_admin' });
  h.interactions.receive(message); await h.interactions.flush();
  assert.equal(h.codex.replies.length, 1);
  await h.restart(); await drain(h);
  assert.equal(h.admission.store.control(message)!.status, 'sent');
  assert.equal(h.codex.replies.length, 1);
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
  const late = h.actor('/approve ' + token, { chat: 'admin', user: 'ou_admin' });
  assert.equal(h.interactions.receive(late).status, 'rejected');
  assert.equal(h.codex.replies.length, 1);
});

test('uncertain dispatch with no native record never retries its approval', async t => {
  const h = setup(t); const task = await h.launch();
  const message = h.actor('/approve absent', { chat: 'admin', user: 'ou_admin' });
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
  const prompt = h.sent.find(row => row.chat === 'admin' && row.text.includes('/reject'))!;
  const token = prompt.text.match(/请求 ([a-f0-9]{8})/)![1];
  const decision = h.actor(' /reject ' + token, { chat: 'admin', user: 'ou_admin' });
  h.interactions.receive(decision); await drain(h);
  assert.equal(h.admission.store.control(decision)!.status, 'sent');
  assert.deepEqual(h.codex.replies, [{ id: 'decline-whitespace', result: { decision: 'decline' } }]);
  const saved = readJournal(join(h.admission.stateDirectory, 'executions', task.request.execution, 'bridge.db'), db =>
    db.prepare('SELECT message,status FROM relayed_controls WHERE origin=?').get(JSON.stringify([decision.tenant, decision.id])) as { message: string; status: string });
  assert.deepEqual(JSON.parse(saved.message), decision);
  assert.equal(saved.status, 'sent');
  assert.equal(h.interactions.receive({ ...decision, text: '/approve ' + token }).status, 'duplicate');
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
  assert.ok(!h.sent.some(row => row.chat === 'admin' && row.text.includes('/approve')));
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
  const message = h.actor('/steer Continue only after this constraint');
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
  const message = h.actor('/steer Stale generation');
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

test('steady synchronization skips retained settled rows but recovers an unprojected admission', async t => {
  const h = setup(t);
  const history = new Set<string>();
  for (let index = 0; index < 10; index++) {
    const message = h.actor('Historical task');
    const result = h.interactions.receive(message); assert.ok('request' in result);
    history.add(result.request.id);
    h.admission.store.routed(result.request.id, false);
  }
  await drain(h);
  assert.equal(h.sent.filter(row => row.text.includes('没有进入预期的调度规则')).length, history.size);
  const lookup = t.mock.method(h.admission.store, 'request');
  const incoming = h.actor('Admitted before a gateway interruption');
  const saved = h.admission.store.accept(incoming, incoming.text, h.admission.project);
  assert.ok('request' in saved);
  await h.restart();
  await drain(h);
  assert.ok(h.reactions.has(incoming.id));
  assert.equal(lookup.mock.calls.filter(call => history.has(call.arguments[0])).length, 0);
  assert.equal(h.sent.filter(row => row.text.includes('没有进入预期的调度规则')).length, history.size);
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
    const message = h.actor('/steer This control bypasses source publication');
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
    const message = h.actor('/steer Apply this before the human delivery finishes');
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
  const supplement = h.actor(' \t/steer Use this quoted detail', { chatType: 'group', createTime: 12346, parentId: 'steering-quote' });
  assert.equal(h.interactions.receive(supplement).status, 'control'); await h.interactions.flush();
  const steer = h.codex.calls.find(call => call.method === 'turn/steer')!.params.input as typeof input;
  assert.ok(steer[0]!.text!.includes('steering-quote')); assert.ok(steer.some(item => item.type === 'image'));
  assert.equal(calls[1]!.limit, 0); assert.equal(calls[1]!.source.id, supplement.id);
  const retire = t.mock.method(h.admission.store, 'retireReferences', () => { throw new Error('interrupted after projection'); });
  h.codex.complete('thread-1', 'turn-2'); const report = await running;
  await h.interactions.transport.sync();
  assert.equal(h.interactions.transport.state.projectedFinal(admitted.request.execution), true);
  assert.ok(h.admission.store.reference(admitted.request.execution, message)!.context);
  retire.mock.restore();
  await h.restart(); await drain(h);
  assert.equal(h.admission.store.reference(admitted.request.execution, message)!.context, null);
  assert.equal(h.admission.store.reference(admitted.request.execution, supplement)!.context, null);
  assert.equal((await h.native.run(grant.permit)).checkpoint, report.checkpoint);
});

test('restart completes a legacy scheduled group request reference under its retained event', async t => {
  const referenced: string[] = [];
  const h = setup(t, undefined, { context: async (_session, message) => {
    referenced.push(message.id);
    return { status: 'available', messages: [], note: 'Recovered reference' };
  } });
  h.config.enableGroups = true;
  const message = h.actor('Legacy scheduled group task', { chatType: 'group', parentId: 'original-quote' });
  const saved = h.admission.store.accept(message, message.text, h.admission.project);
  assert.ok('request' in saved);
  h.admission.store.rememberEvent(saved.request.id, 42);
  h.admission.store.routed(saved.request.id, true);
  assert.equal(h.admission.store.reference(saved.request.execution, message), undefined);
  await h.restart();
  await drain(h);
  assert.deepEqual(referenced, [message.id]);
  assert.equal(h.admission.store.reference(saved.request.execution, message)?.context?.note, 'Recovered reference');
  assert.equal(h.admission.store.submission(saved.request.id)?.event, 42);
  assert.equal(h.admission.store.submission(saved.request.id)?.status, 'scheduled');
  assert.equal(h.admission.store.execution(saved.request.execution), undefined);
});

test('a slow quoted group reference cannot block stop or steer a completed native turn', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fetching = false;
  const h = setup(t, async () => {}, { context: async () => { fetching = true; await gate; return { status: 'available', messages: [], note: 'Quote' }; } });
  h.config.enableGroups = true; const task = await h.launch();
  const supplement = h.actor('/steer Read this quote', { chatType: 'group', parentId: 'slow-quote' });
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
  assert.ok(h.sent.some(row => row.text.includes('/recover 查看检查条件')));
  const inspect = h.actor(' \t/recover'); assert.equal(h.interactions.receive(inspect).status, 'recovery'); await drain(h);
  const prompt = h.sent.find(row => row.options?.replyTo === inspect.id)!;
  assert.ok(prompt.text.includes(task.request.execution)); assert.ok(prompt.text.includes('后代进程'));
  assert.ok(!prompt.text.includes(task.request.input));
  const blocked = h.interactions.receive(h.actor('Do not replay this blocked request')); assert.ok('request' in blocked); assert.equal(blocked.status, 'blocked');
  h.admission.store.maintenance.quiesce();
  const confirm = h.actor('/recover ' + task.request.execution + ' fixture processes stopped; inspected file and external effects');
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
  assert.equal(h.interactions.receive({ ...confirm, text: '/recover ' + fresh.request.execution + ' changed input' }).status, 'duplicate');
  h.interactions.receive(h.actor(confirm.text)); await drain(h);
  assert.equal(h.admission.store.unsettled()[0]!.id, fresh.request.execution);
  assert.equal(h.admission.store.recoveries().length, 1);
});

test('recovery excludes other users, tenants, chats, groups and non-administrator owners', async t => {
  const { h, task } = await unknownForRecovery(t); const count = h.sent.length;
  const text = '/recover ' + task.request.execution + ' fixture inspection';
  for (const fields of [{ user: 'ou_admin' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }]) {
    assert.equal(h.interactions.receive(h.actor(text, fields)).status, 'ignored');
  }
  h.config.approvalUsers = ['ou_admin']; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'other'; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.approvalChat = 'chat'; h.config.allowedUsers = []; assert.equal(h.interactions.receive(h.actor(text)).status, 'ignored');
  h.config.allowedUsers = ['ou_owner'];
  assert.equal(h.interactions.receive(h.actor(text, { unsupported: true })).status, 'rejected');
  assert.equal(h.interactions.receive(h.actor('/recover ' + 'x'.repeat(30_000))).status, 'rejected');
  await drain(h); assert.equal(h.sent.length, count); assert.equal(h.admission.store.recoveries().length, 0);
  assert.equal(h.admission.store.unsettled().length, 1);
});

test('missing or mutated sealed evidence and empty inspection references leave the guard held', async t => {
  const { h, task } = await unknownForRecovery(t);
  const folder = join(h.admission.stateDirectory, 'executions', task.request.execution);
  for (const name of ['native-result.json', 'bridge.db']) {
    const path = join(folder, name), original = readFileSync(path);
    if (name === 'native-result.json') unlinkSync(path); else writeFileSync(path, Buffer.concat([original, Buffer.from('changed')]));
    h.interactions.receive(h.actor('/recover ' + task.request.execution + ' fixture inspection')); await drain(h);
    assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
    writeFileSync(path, original);
  }
  for (const suffix of ['', '   ', 'x'.repeat(1801)]) {
    h.interactions.receive(h.actor('/recover ' + task.request.execution + ' ' + suffix)); await drain(h);
    assert.equal(h.admission.store.recoveries().length, 0);
  }
  assert.ok(h.sent.some(row => row.text.includes('恢复条件尚未满足')));
});

test('an authenticated reachable native owner prevents remote recovery', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch(); h.admission.store.ownerUnconfirmed(task.request.execution);
  h.interactions.receive(h.actor('/recover ' + task.request.execution + ' fixture inspection')); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
  h.codex.complete(task.thread, task.turn); await task.running; await drain(h);
});

test('unstarted admitted backlog prevents remote guard release', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch(); const queued = h.interactions.receive(h.actor('Already admitted next work')); assert.ok('request' in queued);
  h.codex.exit(); await task.running; await drain(h);
  h.interactions.receive(h.actor('/recover')); await drain(h);
  assert.ok(h.sent.some(row => row.text.includes('核对队列')));
  h.interactions.receive(h.actor('/recover ' + task.request.execution + ' fixture inspection')); await drain(h);
  assert.equal(h.admission.store.recoveries().length, 0); assert.equal(h.admission.store.unsettled().length, 1);
  assert.equal(h.admission.store.execution(queued.request.execution), undefined);
});

test('gateway restart repairs committed recovery notice once without repeating its decision', async t => {
  const { h, task } = await unknownForRecovery(t);
  const confirm = h.actor('/recover ' + task.request.execution + ' inspected fixture effects');
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
  const pending = h.actor('/recover ' + task.request.execution + ' inspected fixture effects');
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
  h.interactions.receive(h.actor('/recover ' + task.request.execution + ' inspected fixture effects'));
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
  h.interactions.receive(h.actor('/recover ' + task.request.execution + ' inspected fixture processes and effects')); await drain(h);
  assert.equal(h.admission.store.unsettled().length, 0);
  assert.equal(h.admission.store.conversationThread(task.request.conversation), task.thread);
});

test('closing materializes a committed recovery notice before the restarted gateway polls', async t => {
  const { h, task } = await unknownForRecovery(t);
  const confirm = h.actor('/recover ' + task.request.execution + ' inspected fixture processes and effects');
  h.interactions.receive(confirm); await until(() => h.admission.store.recoveries().length === 1);
  assert.equal(h.interactions.transport.state.pending().some(row => row.replyTo === confirm.id), false);
  await h.restart();
  assert.ok(h.interactions.transport.state.pending().some(row => row.replyTo === confirm.id && row.body.includes('解除该任务')));
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === confirm.id).length, 1);
});

test('incident preview reports native and scheduler facts without changing admission or a sealed journal', async t => {
  const { createServer } = await import('node:http'); const { SourceOutbox, AutoloopSource } = await import('../src/handoff/source.js');
  const { FeishuRecovery } = await import('../src/handoff/recovery.js');
  const { h, task } = await unknownForRecovery(t); h.admission.store.rememberEvent(task.request.id, 3); h.admission.store.routed(task.request.id, true);
  const methods: string[] = [];
  const server = createServer((request, response) => { methods.push(request.method + ' ' + request.url); response.end(JSON.stringify({ event: 3, routed: ['pilot'], paused: [], runs: [{ run: 1, rule: 'pilot', state: 'done' }] })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const source = new SourceOutbox(h.admission, new AutoloopSource('http://127.0.0.1:' + port, 'fixture-key'));
  const recovery = new FeishuRecovery(h.admission, h.config, h.native, source, h.interactions.transport.state);
  const admissionPath = join(h.admission.stateDirectory, 'handoff.db'), journalPath = join(h.admission.stateDirectory, 'executions', task.request.execution, 'bridge.db');
  const beforeAdmission = readFileSync(admissionPath), beforeJournal = readFileSync(journalPath), nativeCalls = h.codex.calls.length;
  const snapshot = h.admission.store.nativeSnapshot; h.admission.store.nativeSnapshot = () => { throw new Error('Diagnostic attempted a reference write'); };
  const query = h.actor('/recover'); assert.equal(recovery.receive(query).status, 'recovery'); await recovery.idle(); h.admission.store.nativeSnapshot = snapshot;
  const report = h.interactions.transport.state.pending().find(row => row.replyTo === query.id)!.body;
  assert.match(report, /核查快照/); assert.match(report, /任务结果：未确认/); assert.match(report, /封存日志：已核实完整/);
  assert.match(report, /Hub 调度轮次：已核实，已结束/); assert.match(report, /任务进程登记：无法核实/); assert.match(report, /业务副作用：无法自动核实/);
  assert.doesNotMatch(report, /Inspect this assigned task|fixture-private-secret/); assert.ok(!report.includes(h.admission.directory));
  assert.deepEqual(methods, ['GET /v1/events/3']); assert.deepEqual(readFileSync(admissionPath), beforeAdmission); assert.deepEqual(readFileSync(journalPath), beforeJournal);
  assert.equal(h.codex.calls.length, nativeCalls); assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
});

test('unauthorized diagnostic views cannot trigger native or source probes', async t => {
  const { h } = await unknownForRecovery(t); let probes = 0;
  h.native.diagnostics = async () => { probes++; throw new Error('Must not probe'); };
  for (const override of [{ user: 'ou_admin' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' }]) assert.equal(h.interactions.receive(h.actor('/recover', override)).status, 'ignored');
  await drain(h); assert.equal(probes, 0);
});

test('live native diagnostic IPC does not mutate its journal or preserve admission references', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = setup(t); const task = await h.launch(); h.admission.store.ownerUnconfirmed(task.request.execution);
  const path = join(h.admission.stateDirectory, 'executions', task.request.execution, 'bridge.db');
  const before = readFileSync(path); const admission = readFileSync(join(h.admission.stateDirectory, 'handoff.db')); const count = h.codex.calls.length;
  const report = await h.native.diagnostics(task.request.execution);
  assert.equal(report.connection, 'reachable'); assert.equal(report.sealed, false); assert.equal(report.recoveryEligible, false);
  assert.deepEqual(readFileSync(path), before); assert.deepEqual(readFileSync(join(h.admission.stateDirectory, 'handoff.db')), admission); assert.equal(h.codex.calls.length, count);
  h.codex.complete(task.thread, task.turn); t.mock.timers.tick(10); await task.running;
});

test('invalid or cross-bound process metadata stays unverified without hiding valid sealed evidence', async t => {
  const { h, task } = await unknownForRecovery(t); const path = join(h.admission.stateDirectory, 'executions', task.request.execution, 'native-processes.json');
  for (const body of ['invalid json', JSON.stringify({ version: 1, binding: 'other-request', owner: null, native: null, descendants: [] })]) {
    writeFileSync(path, body); const report = await h.native.diagnostics(task.request.execution);
    assert.equal(report.sealed, true); assert.equal(report.sealedOutcome, 'unknown'); assert.equal(report.processes, null);
    assert.equal(h.admission.store.unsettled().length, 1); assert.equal(h.admission.store.recoveries().length, 0);
  }
});

test('diagnostic blocked count includes routing blocks and counts combined block reasons once', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = await h.launch();
  const routedBlock = h.interactions.receive(h.actor('Source routing rejected')); assert.ok('request' in routedBlock);
  h.admission.store.routed(routedBlock.request.id, false);
  const combined = h.interactions.receive(h.actor('Queued before uncertain outcome')); assert.ok('request' in combined);
  h.codex.exit(); await task.running;
  assert.equal(h.admission.store.reserve(combined.request.id, 2).kind, 'blocked'); h.admission.store.routed(combined.request.id, false);
  const guardBlock = h.interactions.receive(h.actor('Blocked after uncertain outcome')); assert.equal(guardBlock.status, 'blocked');
  const query = h.actor('/recover'); h.interactions.receive(query); await drain(h);
  const report = h.sent.find(row => row.options?.replyTo === query.id)!.text;
  assert.match(report, /已接收未执行：0；已阻断：3/);
  assert.ok('request' in guardBlock);
  assert.equal(h.interactions.receive(h.actor('/withdraw ' + guardBlock.request.execution)).status, 'withdrawn');
  const after = h.actor('/recover'); h.interactions.receive(after); await drain(h);
  assert.match(h.sent.find(row => row.options?.replyTo === after.id)!.text, /已接收未执行：0；已阻断：2/);
  assert.equal(h.admission.store.unsettled()[0]!.id, task.request.execution);
});

test('owner-private queue view is bounded, content-free and does not mutate admission or invoke native work', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const requests = Array.from({ length: 12 }, (_, i) => h.interactions.receive(h.actor('Private command and path fixture-private-secret ' + i, { createTime: String(1000 + i) })));
  h.admission.store.accept(h.actor('Foreign secret', { user: 'ou_other' }), 'Foreign secret', h.admission.project);
  const first = requests[0]!; assert.ok('request' in first);
  const view = h.actor(' \t/queue');
  const before = readFileSync(join(h.admission.stateDirectory, 'handoff.db'));
  for (const changes of [{ user: 'ou_other' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }]) assert.equal(h.interactions.receive({ ...view, ...changes, id: randomUUID() }).status, 'ignored');
  assert.equal(h.interactions.receive(view).status, 'queue');
  const reply = h.interactions.transport.state.pending().find(row => row.replyTo === view.id)!;
  assert.match(reply.body, /12 个（显示前 10 个）/); assert.equal((reply.body.match(/\/withdraw [0-9a-f-]{36}/g) ?? []).length, 10);
  assert.match(reply.body, /^### 任务队列/); assert.match(reply.body, /```\n\/withdraw /);
  assert.ok(reply.body.includes(first.request.execution)); assert.doesNotMatch(reply.body, /Private command|Foreign secret|fixture-private-secret/);
  assert.deepEqual(readFileSync(join(h.admission.stateDirectory, 'handoff.db')), before); assert.equal(h.codex.calls.length, 0);
  assert.equal(h.interactions.receive({ ...view, text: '/withdraw ' + first.request.execution }).status, 'duplicate');
  h.config.approvalUsers = ['ou_admin']; assert.equal(h.interactions.receive(h.actor('/queue')).status, 'ignored');
  assert.equal(h.admission.store.withdrawals().length, 0);
});

test('quoted exact withdrawal retires queued feedback while preserving the actual active native turn and maintenance pause', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat'; const active = await h.launch();
  const queued = h.interactions.receive(h.actor('Queued request')); assert.ok('request' in queued); await h.interactions.flush();
  h.admission.store.maintenance.quiesce(); const decision = h.actor(' /withdraw', { parentId: queued.request.message.id });
  assert.equal(h.interactions.receive(decision).status, 'withdrawn'); await drain(h);
  assert.equal(h.admission.store.withdrawals().length, 1); assert.equal(h.admission.store.withdrawals()[0]!.actor, JSON.stringify(['tenant', 'ou_owner', 'chat']));
  assert.equal(h.admission.store.execution(queued.request.execution), undefined); assert.equal(h.admission.store.drainStatus().queued, 0);
  assert.equal(h.admission.store.unsettled()[0]!.id, active.request.execution); assert.equal(h.admission.store.maintenance.paused, true);
  assert.equal(h.reactions.has(queued.request.message.id), false);
  assert.equal(h.codex.calls.filter(row => row.method === 'turn/start').length, 1); assert.equal(h.codex.calls.some(row => row.method === 'turn/interrupt'), false);
  const notice = h.sent.filter(row => row.options?.replyTo === decision.id && row.text.includes('已撤回尚未开始')); assert.equal(notice.length, 1);
  assert.equal(h.interactions.receive({ ...decision, text: 'Must not become a new request' }).status, 'ignored');
  await h.restart(); await drain(h); assert.equal(h.sent.filter(row => row.id === notice[0]!.id).length, 1);
  assert.equal(h.admission.store.reserve(queued.request.id, 9).kind, 'withdrawn');
  h.codex.complete(active.thread, active.turn); await active.running; await drain(h);
});

test('withdrawal requires an exact owned unstarted request and cannot use a conflicting quote or stale authority', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat'; const active = await h.launch();
  const one = h.interactions.receive(h.actor('one')), two = h.interactions.receive(h.actor('two')); assert.ok('request' in one && 'request' in two);
  for (const message of [h.actor('/withdraw'), h.actor('/withdraw not-an-id'), h.actor('/withdraw ' + active.request.execution),
    h.actor('/withdraw ' + one.request.execution, { parentId: two.request.message.id }), h.actor('/withdraw', { parentId: 'foreign-message' }),
    h.actor('/withdraw ' + randomUUID()), h.actor('/withdraw ' + one.request.execution + ' and another')]) {
    assert.equal(h.interactions.receive(message).status, 'rejected');
  }
  assert.equal(h.admission.store.withdrawals().length, 0);
  h.codex.complete(active.thread, active.turn); await active.running;
  assert.equal(h.interactions.receive(h.actor('/withdraw ' + active.request.execution)).status, 'rejected');
  assert.equal(h.interactions.receive(h.actor('/withdraw ' + one.request.execution.toUpperCase())).status, 'withdrawn');
  assert.equal(h.interactions.receive(h.actor('/withdraw ' + one.request.execution)).status, 'withdrawn');
  assert.equal(h.admission.store.withdrawals().length, 1); assert.equal(h.admission.store.request(two.request.id)!.blocked, null);
});

test('committed withdrawal notices repair after projection interruption and retry delivery under one identity', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat';
  const task = h.interactions.receive(h.actor('queued')); assert.ok('request' in task);
  const project = h.interactions.transport.state.projectWithdrawalNotice.bind(h.interactions.transport.state);
  h.interactions.transport.state.projectWithdrawalNotice = () => { throw new Error('Interrupted projection'); };
  const decision = h.actor('/withdraw ' + task.request.execution);
  assert.equal(h.interactions.receive(decision).status, 'withdrawn');
  assert.equal(h.admission.store.withdrawals().length, 1); assert.equal(h.interactions.transport.state.withdrawalNoticeProjected(JSON.stringify([decision.tenant, decision.id])), false);
  h.interactions.transport.state.projectWithdrawalNotice = project;
  const attempted: string[] = [];
  h.setSend(async (_chat, text, id) => { if (text.includes('已撤回尚未开始')) { attempted.push(id); throw new Error('Lost acknowledgement'); } return 'ack'; });
  await drain(h); assert.equal(attempted.length, 1); await h.restart();
  h.setSend(async (chat, text, id, options) => { h.sent.push({ chat, text, id, options }); return 'ack-' + id; });
  const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(join(h.admission.stateDirectory, 'transport/bridge.db'));
  db.prepare('UPDATE outbox SET next=0').run(); db.close(); await drain(h);
  assert.equal(h.sent.filter(row => row.id === attempted[0]).length, 1); assert.equal(h.admission.store.withdrawals().length, 1);
  assert.equal(h.codex.calls.length, 0); assert.equal(h.admission.store.unsettled().length, 0); assert.equal(h.reactions.size, 0);
});

test('pilot English help is local, deduplicated and available while paused; retired controls cannot schedule or decide', async t => {
  const h = setup(t); h.config.approvalUsers = ['ou_owner']; h.config.approvalChat = 'chat'; h.admission.store.maintenance.quiesce();
  const help = h.actor(' \t/help');
  assert.equal(h.interactions.receive({ ...help, user: 'other' }).status, 'ignored');
  assert.equal(h.interactions.receive(help).status, 'help'); assert.equal(h.interactions.receive(help).status, 'duplicate');
  await drain(h); const body = h.sent.find(row => row.options?.replyTo === help.id)!.text;
  for (const token of ['/steer', '/approve', '/reject', '/answer', '/recover', '/queue', '/withdraw', '/status details']) assert.ok(body.includes(token));
  assert.ok(!body.includes('/notify') && !body.includes('/clear')); assert.equal(h.admission.store.requests().length, 0); assert.equal(h.codex.calls.length, 0);
  h.admission.store.maintenance.resume();
  for (const text of ['/恢复', '/队列', '/撤回 ' + randomUUID(), '/批准 missing', '/回答 missing answer', '/补充 text']) {
    const message = h.actor(text); assert.equal(h.interactions.receive(message).status, 'rejected');
    await drain(h); assert.ok(h.sent.some(row => row.options?.replyTo === message.id && row.text.includes('/help')));
  }
  assert.equal(h.admission.store.requests().length, 0); assert.equal(h.admission.store.controls().length, 0);
  assert.equal(h.admission.store.recoveries().length, 0); assert.equal(h.admission.store.withdrawals().length, 0); assert.equal(h.codex.calls.length, 0);
});

test('switching matters starts separate native threads and quoting the older task resumes its original thread', async t => {
  const h = setup(t);
  const complete = async (request: { id: string }, run: number) => {
    const issued = h.admission.store.reserve(request.id, run);
    assert.equal(issued.kind, 'start');
    if (issued.kind !== 'start') throw Error('Expected assignment');
    const count = h.codex.calls.filter(call => call.method === 'turn/start').length;
    const running = h.native.run(issued.permit);
    const turns = () => h.codex.calls.filter(call => call.method === 'turn/start');
    await until(() => turns().length > count);
    const thread = String(turns().at(-1)!.params.threadId);
    const sequence = h.codex.calls.filter(call => ['thread/start', 'turn/start'].includes(call.method)).length;
    h.codex.complete(thread, 'turn-' + sequence);
    await running;
    return thread;
  };

  const newRefund = h.actor('/matter-new 退款调查');
  h.interactions.receive(newRefund);
  await drain(h);
  const card = h.sent.find(item => item.options?.replyTo === newRefund.id)!;
  const matter = card.options!.matterCard!;
  assert.equal(matter.title, '退款调查');
  const initial = h.actor('查退款积压');
  const a = h.interactions.receive(initial);
  assert.ok('request' in a);
  const threadA = await complete(a.request, 101);

  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const b = h.interactions.receive(h.actor('检查待发布版本'));
  assert.ok('request' in b);
  assert.notEqual(a.request.conversation, b.request.conversation);
  assert.equal(a.request.project, b.request.project);
  const threadB = await complete(b.request, 102);
  assert.notEqual(threadA, threadB);

  await h.restart();
  const quote = h.actor('再看微信渠道', { parentId: initial.id });
  assert.equal(h.interactions.receive(quote).status, 'task-reply');
  const followup = h.admission.store.requestForMessage(quote)!;
  assert.equal(followup.conversation, a.request.conversation);
  assert.equal(await complete(followup, 103), threadA);
  const cardReply = h.interactions.receive(h.actor('只查询最近的发布记录', { parentId: 'delivered-' + card.id }));
  assert.ok('request' in cardReply);
  assert.equal(cardReply.request.conversation, a.request.conversation);
  const plain = h.interactions.receive(h.actor('继续刚才的处理'));
  assert.ok('request' in plain);
  assert.equal(plain.request.conversation, b.request.conversation);
  assert.equal(h.codex.calls.filter(call => call.method === 'thread/start').length, 2);
});

test('registered PRs take precedence and an ambiguous input is published once after a confirmed choice', async t => {
  const h = setup(t);
  const a = h.actor('/matter-new Solura 发版');
  const b = h.actor('/matter-new Go Global 发版');
  h.interactions.receive(a);
  h.interactions.receive(h.actor('/matter-bind https://github.com/Org/solura/pull/9'));
  h.interactions.receive(b);
  h.interactions.receive(h.actor('/matter-bind https://github.com/Org/backend/pull/7'));
  await drain(h);
  const aCard = h.sent.find(item => item.options?.replyTo === a.id)!;
  const bCard = h.sent.find(item => item.options?.replyTo === b.id)!;
  const aView = aCard.options!.matterCard!, bView = bCard.options!.matterCard!;
  const click = (row: typeof aCard, choice: string, event = randomUUID()) => ({
    id: row.options!.matterCard!.id, choice, event, message: 'delivered-' + row.id,
    chat: h.admission.scope.chat, user: h.admission.scope.operator, tenant: h.admission.scope.tenant,
  });
  const direct = h.interactions.receive(h.actor('检查 https://github.com/org/Solura/pull/9/files?diff=split'));
  assert.ok('request' in direct);
  assert.equal(direct.request.conversation, aView.anchor);

  const deferred = h.actor('昨天那个发版再查一下');
  assert.equal(h.interactions.receive(deferred).status, 'matter-choice');
  assert.equal(h.interactions.receive(deferred).status, 'matter-choice');
  assert.equal(h.admission.store.requestForMessage(deferred), undefined);
  await drain(h);
  const cards = h.sent.filter(item => item.options?.replyTo === deferred.id);
  assert.equal(cards.length, 1);
  const choice = cards[0]!;
  const selected = click(choice, aView.anchor!);
  assert.deepEqual(choice.options!.matterCard!.choices.map(c => c.id).sort(), [aView.anchor, bView.anchor].sort());
  const displayed = matterCard(choice.options!.matterCard!).body.elements[1]!;
  assert.equal(displayed.tag, 'button');
  assert.ok('behaviors' in displayed);
  const platform = { schema: '2.0', app_id: 'fixture', host: 'im_message', event_id: selected.event,
    tenant_key: selected.tenant, operator: { tenant_key: selected.tenant, open_id: selected.user },
    context: { open_chat_id: selected.chat, open_message_id: selected.message },
    action: { tag: 'button', value: displayed.behaviors![0]!.value } };
  assert.equal(normalizeMatterClick(platform, 'fixture')?.id, selected.id);
  assert.equal(normalizeMatterClick(platform, 'other-app'), undefined);
  await h.restart();
  assert.equal(h.interactions.matterAction({ ...selected, event: randomUUID(), user: 'ou_admin' }), 'rejected');
  assert.equal(h.interactions.matterAction({ ...selected, event: randomUUID(), message: 'other-message' }), 'rejected');
  assert.equal(h.interactions.matterAction({ ...selected, event: randomUUID(), choice: 'default' }), 'rejected');
  assert.equal(h.admission.store.requestForMessage(deferred), undefined);
  const pausedClick = { ...selected, event: randomUUID() };
  h.admission.store.maintenance.quiesce();
  assert.equal(h.interactions.matterAction(pausedClick), 'rejected');
  h.admission.store.maintenance.resume();
  assert.equal(h.interactions.matterAction(pausedClick), 'rejected');
  assert.equal(h.admission.store.requestForMessage(deferred), undefined);
  assert.equal(h.interactions.matterAction(selected), 'accepted');
  assert.equal(h.admission.store.requestForMessage(deferred)?.conversation, aView.anchor);
  const switched = click(bCard, bView.anchor!);
  assert.equal(h.interactions.matterAction(switched), 'accepted');
  assert.equal(h.interactions.matterAction({ ...selected, event: randomUUID(), choice: bView.anchor! }), 'rejected');
  const next = h.interactions.receive(h.actor('继续'));
  assert.ok('request' in next);
  assert.equal(next.request.conversation, bView.anchor);
  const count = h.admission.store.requests().length;
  assert.equal(h.interactions.receive(deferred).status, 'duplicate');
  assert.equal(h.admission.store.requests().length, count);
  assert.equal(h.codex.calls.length, 0);
});

test('previous admission state keeps the default thread and request foreign keys on the matter schema', t => {
  const root = mkdtempSync(join(tmpdir(), 'matter-schema-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat',
    projects: { pilot: root }, pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const actor = { tenant: 'tenant', user: 'ou_owner', chat: 'chat', chatType: 'p2p' as const, id: 'original', text: 'original input' };
  const registry = new PilotAdmission(root, scope);
  const project = registry.project; registry.close();
  // Build the old database independently with the legacy unique constraint.
  const oldRoot = join(root, 'old'); mkdirSync(oldRoot);
  const file = join(oldRoot, 'handoff.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE conversations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,project TEXT NOT NULL,
      thread TEXT,last_execution TEXT,UNIQUE(owner,project));
    CREATE TABLE requests(id TEXT PRIMARY KEY,execution TEXT NOT NULL UNIQUE,conversation TEXT NOT NULL REFERENCES conversations(id),
      project TEXT NOT NULL,origin TEXT NOT NULL UNIQUE,message TEXT NOT NULL,input TEXT NOT NULL,blocked TEXT);
  `);
  old.prepare('INSERT INTO conversations VALUES (?,?,?,?,?)').run('previous-conversation', ownerKey(actor), project, 'previous-thread', null);
  old.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,NULL)').run('previous-request', 'previous-execution',
    'previous-conversation', project, JSON.stringify([actor.tenant, actor.id]), JSON.stringify(actor), actor.text);
  old.close();
  const admitted = new PilotAdmission(oldRoot, scope);
  t.after(() => admitted.close());
  assert.equal(admitted.store.requestForMessage(actor)?.conversation, 'previous-conversation');
  assert.equal(admitted.store.conversationThread('previous-conversation'), 'previous-thread');
  const named = admitted.store.matters.create({ owner: ownerKey(actor), project }, { ...actor, id: 'new-matter' }, '退款');
  const b = admitted.receive({ ...actor, id: 'named-request' }, named.id);
  const a = admitted.receive({ ...actor, id: 'default-request' });
  assert.ok('request' in b && 'request' in a);
  assert.equal(a.request.conversation, 'previous-conversation');
  assert.equal(b.request.conversation, named.id);
  assert.equal(admitted.store.conversationThread(named.id), null);
  assert.equal(admitted.store.reserve(a.request.id, 80).kind, 'start');
  assert.equal(admitted.store.reserve(b.request.id, 81).kind, 'busy');
  const inspect = new DatabaseSync(file, { readOnly: true });
  try { assert.deepEqual(inspect.prepare('PRAGMA foreign_key_check').all(), []); }
  finally { inspect.close(); }
});

test('gateway restart projects a held clarification that had no transport receipt', async t => {
  const h = setup(t);
  h.interactions.receive(h.actor('/matter-new First'));
  h.interactions.receive(h.actor('/matter-new Second'));
  await drain(h);
  const message = h.actor('Which one?');
  const scope = { owner: ownerKey(message), project: h.admission.project };
  const choices = h.admission.store.matters.list(scope, 2).map(m => m.id);
  const held = h.admission.store.matters.hold(scope, message, choices);
  await h.restart();
  await drain(h);
  const matches = h.sent.filter(item => item.options?.replyTo === message.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.options?.matterCard?.id, held.id);
  assert.equal(h.admission.store.requestForMessage(message), undefined);
  assert.equal(h.admission.store.matters.unprojected().length, 0);
});

test('maintained matter commands and overflowing inputs cannot reroute on redelivery', async t => {
  const h = setup(t);
  const actor = h.actor('');
  const scope = { owner: ownerKey(actor), project: h.admission.project };
  const store = h.admission.store.matters;
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const before = store.focus(scope);
  const canceledCreate = h.actor('/matter-new Deferred release');
  const canceledBind = h.actor('/matter-bind https://github.com/fixture/repo/pull/75');
  h.admission.store.maintenance.quiesce();
  h.interactions.receive(canceledCreate);
  h.interactions.receive(canceledBind);
  await drain(h);
  await h.restart();
  h.admission.store.maintenance.resume();
  h.interactions.receive(canceledCreate);
  h.interactions.receive(canceledBind);
  assert.equal(store.focus(scope), before);
  assert.equal(store.named(scope, 'Deferred release'), undefined);
  assert.equal(store.bound(scope, 'fixture/repo/pull/75'), undefined);
  for (let i = 1; i < 7; i++) h.interactions.receive(h.actor('/matter-new Project' + i + ' 发版'));
  const overflow = h.actor('确认发版 https://github.com/fixture/repo/pull/75');
  assert.equal(h.interactions.receive(overflow).status, 'matter-choice');
  h.interactions.receive(h.actor('/matter-bind https://github.com/fixture/repo/pull/75'));
  const routed = h.interactions.receive(overflow);
  assert.equal(routed.status, 'matter-choice');
  assert.equal(h.admission.store.requestForMessage(overflow), undefined);
  assert.ok('request' in h.interactions.receive(h.actor(overflow.text)), 'only the fresh message uses the new binding');
});

test('a committed matter creation produces its original card after a transport write failure and restart', async t => {
  const h = setup(t);
  const message = h.actor('/matter-new 退款调查');
  const transport = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  try {
    transport.exec(`CREATE TRIGGER fail_card BEFORE INSERT ON outbox WHEN NEW.matter_card IS NOT NULL
      BEGIN SELECT RAISE(ABORT,'fixture transport failure'); END;`);
    assert.throws(() => h.interactions.receive(message), /fixture transport failure/);
    const scope = { owner: ownerKey(message), project: h.admission.project };
    const original = h.admission.store.matters.named(scope, '退款调查')!;
    assert.ok(original);
    assert.equal(h.admission.store.matters.unprojectedNotices().length, 1);
    transport.exec('DROP TRIGGER fail_card');
    h.interactions.receive(h.actor('/matter-new Solura 发版'));
    const later = h.admission.store.matters.focus(scope);
    await h.restart();
    await drain(h);
    const messages = h.sent.filter(m => m.options?.replyTo === message.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.options?.matterCard?.anchor, original.id);
    assert.equal(h.admission.store.matters.focus(scope), later);
    assert.equal(h.admission.store.matters.unprojectedNotices().length, 0);
  } finally { transport.close(); }
});

test('matter card delivery retains its idempotency key until the platform ID and outbox settlement commit', async t => {
  const h = setup(t);
  const sends: string[] = [];
  let missing = true;
  h.setSend(async (_chat, _text, id) => {
    sends.push(id);
    return missing ? undefined : 'platform-id';
  });
  const transport = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  const pending = () => transport.prepare('SELECT id FROM outbox WHERE matter_card IS NOT NULL').get() as { id: string } | undefined;
  try {
    h.interactions.receive(h.actor('/matter-new 退款调查'));
    await h.interactions.flush();
    const first = pending()?.id;
    assert.ok(first);
    assert.deepEqual(sends, [first]);
    missing = false;
    transport.exec(`CREATE TRIGGER fail_binding BEFORE UPDATE OF message ON matter_cards
      BEGIN SELECT RAISE(ABORT,'fixture bind failure'); END;`);
    transport.exec('UPDATE outbox SET next=0');
    await h.interactions.flush();
    assert.equal(pending()?.id, first);
    assert.equal((transport.prepare('SELECT message FROM matter_cards').get() as { message: string | null }).message, null);
    transport.exec('DROP TRIGGER fail_binding');
    transport.exec('UPDATE outbox SET next=0');
    await h.restart();
    await h.interactions.flush();
    assert.deepEqual(sends, [first, first, first]);
    assert.equal(pending(), undefined);
    assert.equal((transport.prepare('SELECT message FROM matter_cards').get() as { message: string | null }).message, 'platform-id');
  } finally { transport.close(); }
});

test('an unresolved card reply is held while another matter is selected', async t => {
  const h = setup(t);
  const newB = h.actor('/matter-new Solura 发版');
  h.interactions.receive(newB); await drain(h);
  const b = h.sent.find(row => row.options?.replyTo === newB.id)!;
  const newA = h.actor('/matter-new 退款调查');
  const transport = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  let acknowledge = false;
  try {
    h.setSend(async (chat, text, id, options) => {
      h.sent.push({ chat, text, id, options });
      return options?.replyTo === newA.id ? acknowledge ? 'visible-a-card' : undefined : 'delivered-' + id;
    });
    h.interactions.receive(newA); await h.interactions.flush();
    assert.equal(h.interactions.matterAction({ id: b.options!.matterCard!.id, event: randomUUID(), tenant: b.options!.matterCard!.tenant,
      user: b.options!.matterCard!.user, chat: b.chat, message: 'delivered-' + b.id, choice: b.options!.matterCard!.anchor! }), 'accepted');
    const unclear = h.actor('继续查一下', { parentId: 'visible-a-card' });
    assert.equal(h.interactions.receive(unclear).status, 'matter-choice');
    assert.equal(h.admission.store.requestForMessage(unclear), undefined);
    acknowledge = true;
    transport.exec('UPDATE outbox SET next=0');
    await drain(h);
    assert.equal(h.interactions.receive(unclear).status, 'matter-choice');
    assert.equal(h.admission.store.requestForMessage(unclear), undefined);
    const fresh = h.interactions.receive(h.actor('继续查一下', { parentId: 'visible-a-card' }));
    assert.ok('request' in fresh);
    assert.equal(fresh.request.conversation,
      h.admission.store.matters.named({ owner: ownerKey(newA), project: h.admission.project }, '退款调查')!.id);
  } finally { transport.close(); }
});

test('a late parent cannot convert a held or refused reply into a quoted-task supplement', async t => {
  for (const number of [2, 7]) {
    const h = setup(t);
    for (let i = 1; i <= number; i++) h.interactions.receive(h.actor('/matter-new Project' + i + ' 发版'));
    const parent = h.actor('Project1 发版：检查发布内容');
    const early = h.actor('确认发版', { parentId: parent.id });
    assert.equal(h.interactions.receive(early).status, 'matter-choice');
    const scope = { owner: ownerKey(early), project: h.admission.project };
    const saved = number === 2 ? h.admission.store.matters.held(early, scope.project) : h.admission.store.matters.notice(early);
    assert.ok(saved);
    const admitted = h.interactions.receive(parent);
    assert.ok('request' in admitted);
    await h.restart();
    assert.equal(h.interactions.receive(early).status, 'matter-choice');
    assert.equal(h.admission.store.requestForMessage(early), undefined);
    assert.equal(h.admission.store.taskReply(JSON.stringify([early.tenant, early.id])), undefined);
    assert.equal(h.admission.store.request(admitted.request.id)?.input, '检查发布内容');
  }
});

test('an exact matter address can use a project alias as its name without changing the canonical project', async t => {
  const h = setup(t, undefined, undefined, ['backend', 'other']);
  const newMatter = h.actor('/matter-new backend');
  h.interactions.receive(newMatter);
  const routed = h.interactions.receive(h.actor('backend: check release'));
  assert.ok('request' in routed);
  assert.equal(routed.request.input, 'check release');
  assert.equal(routed.request.conversation,
    h.admission.store.matters.named({ owner: ownerKey(newMatter), project: h.admission.project }, 'backend')!.id);
  assert.equal(routed.request.project, h.admission.project);
  const refused = h.actor('other: check release');
  assert.equal(h.interactions.receive(refused).status, 'rejected');
  h.interactions.receive(h.actor('/matter-new other'));
  assert.equal(h.interactions.receive(refused).status, 'ignored');
  assert.equal(h.admission.store.requestForMessage(refused), undefined);
  assert.equal(h.admission.store.requests().length, 1);
  assert.ok('request' in h.interactions.receive(h.actor(refused.text)));
});

test('a referenced matter card and a conflicting exact address require a confirmed choice', async t => {
  const h = setup(t);
  const a = h.actor('/matter-new 退款调查'), b = h.actor('/matter-new Solura 发版');
  h.interactions.receive(a);
  h.interactions.receive(b);
  h.interactions.receive(h.actor('/matter-bind https://github.com/fixture/release/pull/17'));
  await drain(h);
  const cardA = h.sent.find(item => item.options?.replyTo === a.id)!;
  const cardB = h.sent.find(item => item.options?.replyTo === b.id)!;
  const parentId = 'delivered-' + cardA.id;
  const conflicting = h.actor('Solura 发版：再查发布结果', { parentId });
  const conflictingLink = h.actor('再查 https://github.com/fixture/release/pull/17', { parentId });
  assert.equal(h.interactions.receive(conflicting).status, 'matter-choice');
  assert.equal(h.interactions.receive(conflictingLink).status, 'matter-choice');
  assert.equal(h.admission.store.requests().length, 0);
  await drain(h);
  const clarification = h.sent.find(item => item.options?.replyTo === conflicting.id)!;
  const selected = cardB.options!.matterCard!.anchor!;
  const view = clarification.options!.matterCard!;
  assert.deepEqual(view.choices.map(c => c.id).sort(), [cardA.options!.matterCard!.anchor, selected].sort());
  assert.equal(h.interactions.matterAction({ id: view.id, event: randomUUID(), chat: view.chat,
    user: view.user, tenant: view.tenant, message: 'delivered-' + clarification.id, choice: selected }), 'accepted');
  const task = h.admission.store.requestForMessage(conflicting);
  assert.equal(task?.conversation, selected);
  assert.equal(task?.input, '再查发布结果');
  assert.equal(h.admission.store.requestForMessage(conflictingLink), undefined);
});
