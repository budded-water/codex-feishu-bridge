import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as lark from '@larksuiteoapi/node-sdk';
import { Feishu, normalizeMessage } from '../src/feishu.js';
import { record } from '../src/types.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { OwnerTasks } from '../src/handoff/tasks.js';
import { taskCard, normalizeTaskRefresh, type TaskPresentation, type TaskRefreshClick } from '../src/task-card.js';
import type { Config } from '../src/config.js';
import type { DeliveryOptions } from '../src/types.js';
import { FakeCodex, message, until } from './helpers.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  generation = randomUUID();
  async start() { this.ready = true; }
  async close() { this.exit(); }
}

function setup(t: TestContext, secrets: string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'owner-tasks-'))), workspace = join(root, 'workspace'); mkdirSync(workspace);
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: workspace },
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { accessMode: 'allowlist', allowedUsers: ['ou_owner'], approvalUsers: ['ou_owner'], approvalChat: null,
    allowedTenant: 'tenant', enableGroups: false, groupContextMessages: 0, groupContextImages: 0, projects: scope.projects,
    projectRouting: 'workspace', codexExecutable: 'codex', stateDirectory: join(root, 'state'), approvalTimeoutSeconds: 300 };
  const admission = new PilotAdmission(config.stateDirectory, scope, 'workspace'), codexes: ManagedFake[] = [];
  const native = new NativeExecutions(admission, config, () => { const c = new ManagedFake(); codexes.push(c); return c; });
  const sent: { body: string; id: string; options?: DeliveryOptions }[] = [], updates: { message: string; p: TaskPresentation }[] = [];
  let failUpdate = false;
  const sender = { send: async (_chat: string, body: string, id: string, options?: DeliveryOptions) => { sent.push({ body, id, options }); return 'om_' + id; },
    updateTask: async (message: string, p: TaskPresentation) => { updates.push({ message, p }); if (failUpdate) throw Error('Uncertain patch acknowledgement'); } };
  const reactions = { addReaction: async () => 'reaction', findReaction: async () => undefined, removeReaction: async () => {} };
  let interactions = new PilotInteractions(admission, config, { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, secrets);
  const views = () => new OwnerTasks(admission, config, native, interactions.transport.state, {});
  const pending: Promise<unknown>[] = []; let run = 0;
  const admit = (text = 'Inspect the project') => { const r = interactions.receive(message(text, { chatType: 'p2p' })); assert.ok('request' in r); return r.request; };
  const start = async (request = admit()) => {
    const index = codexes.length;
    const grant = admission.store.reserve(request.id, ++run); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('no grant');
    const running = native.run(grant.permit); pending.push(running);
    await until(() => Boolean(codexes[index]?.calls.some(c => c.method === 'turn/start')));
    const c = codexes[index]!, call = c.calls.find(c => c.method === 'turn/start')!;
    const current = { threadId: String(call.params.threadId), turnId: 'turn-' + (c.calls.some(c => c.method === 'thread/start') ? '2' : '1') };
    return { request, running, c, current, complete: () => c.complete(current.threadId, current.turnId) };
  };
  const drain = async () => { for (let i = 0; i < 5; i++) await interactions.flush(); };
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config,
    { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, secrets); await interactions.start(); };
  t.after(async () => { await native.stop(); await Promise.allSettled(pending); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, config, admission, native, codexes, sent, updates, views, admit, start, drain, restart,
    fail: (value: boolean) => { failUpdate = value; }, get interactions() { return interactions; } };
}

const click = (card: { id: string; options?: DeliveryOptions }, overrides: Partial<TaskRefreshClick> = {}): TaskRefreshClick => ({ kind: 'task-refresh',
  event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'om_' + card.id, id: card.options!.taskView!.id, ...overrides });

test('owner task browsing is scoped, paginated and rejected commands never become tasks', async t => {
  const h = setup(t), owner = h.views();
  for (let i = 0; i < 12; i++) h.admit('Task ' + i);
  h.admission.store.accept(message('FOREIGN_SECRET', { user: 'other', chatType: 'p2p' }), 'foreign', h.admission.project);
  const before = h.admission.store.requests().length;
  for (const changes of [{ user: 'other' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }]) owner.receive(message('/tasks', { chatType: 'p2p', ...changes }));
  h.config.approvalUsers = []; owner.receive(message('/tasks', { chatType: 'p2p' })); await owner.idle(); assert.equal(h.interactions.transport.state.pending().length, 0);
  h.config.approvalUsers = ['ou_owner'];
  for (const text of ['/tasks 1', '/tasks 2', '/tasks 3', '/tasks 0', '/task ' + randomUUID()]) { owner.receive(message(text, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush(); }
  const bodies = h.sent.map(s => s.body);
  assert.ok(bodies.some(b => b.includes('第 1/2 页') && (b.match(/\/task [a-f0-9-]{36}/g) ?? []).length === 10));
  assert.ok(bodies.some(b => b.includes('第 2/2 页') && (b.match(/\/task [a-f0-9-]{36}/g) ?? []).length === 2));
  assert.ok(bodies.some(b => b.includes('页码超出范围'))); assert.ok(!bodies.some(b => b.includes('FOREIGN_SECRET')));
  assert.equal(h.admission.store.requests().length, before); assert.equal(h.codexes.length, 0);
});

test('native progress is authenticated and read-only, with real command stage and pending prompt category', async t => {
  const h = setup(t), task = await h.start();
  task.c.notify('item/started', { ...task.current, item: { type: 'commandExecution', id: 'cmd', command: 'PRIVATE_COMMAND' } });
  const path = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db');
  const snapshot = () => { const d = new DatabaseSync(path, { readOnly: true }); const v = ['tasks', 'outbox', 'approvals', 'seen'].map(name => d.prepare('SELECT * FROM ' + name).all()); d.close(); return JSON.stringify(v); };
  const before = snapshot(), calls = task.c.calls.length, requests = h.admission.store.requests(), guards = h.admission.store.unsettled();
  const progress = await h.native.progress(task.request.execution); assert.equal(progress.live, true); assert.match(progress.activity!.stage, /等待命令结果/);
  assert.equal(snapshot(), before); assert.equal(task.c.calls.length, calls); assert.deepEqual(h.admission.store.requests(), requests); assert.deepEqual(h.admission.store.unsettled(), guards);
  const generation = task.c.generation; task.c.generation = randomUUID();
  await assert.rejects(h.native.progress(task.request.execution), /identity differs/); task.c.generation = generation;
  task.c.ask('approval', 'item/commandExecution/requestApproval', { ...task.current, command: 'PRIVATE_COMMAND', reason: 'Test prompt' });
  const waiting = await h.native.progress(task.request.execution); assert.match(waiting.activity!.stage, /管理员确认/); assert.equal(waiting.activity!.prompts[0]!.kind, 'approval');
  const view = h.views(); view.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await view.idle(); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card.body.includes('本轮已用')); assert.ok(card.body.includes('/approve ')); assert.ok(!JSON.stringify(card).includes('PRIVATE_COMMAND'));
  assert.equal(task.c.replies.length, 0); await h.interactions.receive(message('/stop', { chatType: 'p2p' })); await task.running;
});

test('detail cards refresh the same confirmed message once across duplicate callbacks and restart', async t => {
  const h = setup(t), request = h.admit(), owner = h.views(), query = message('/task ' + request.execution, { chatType: 'p2p' });
  owner.receive(query); owner.receive(query); await owner.idle(); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card, JSON.stringify(h.sent)); assert.equal(h.sent.filter(s => s.options?.taskView).length, 1);
  assert.ok(JSON.stringify(taskCard(card.options!.taskView!)).includes('刷新进度'));
  for (const bad of [{ user: 'other' }, { chat: 'other' }, { tenant: 'other' }, { message: 'om_foreign' }, { id: randomUUID() }]) assert.equal(owner.refresh(click(card, bad)), 'rejected');
  const event = click(card); assert.equal(owner.refresh(event), 'accepted'); owner.refresh(event); await owner.idle(); await h.interactions.transport.flush();
  assert.equal(h.updates.length, 1); assert.equal(h.updates[0]!.message, 'om_' + card.id);
  await h.restart(); const next = h.views(); next.receive(query); next.refresh(event); await next.idle(); await h.interactions.transport.flush();
  assert.equal(h.updates.length, 1); assert.equal(h.sent.filter(s => s.options?.taskView).length, 1); assert.equal(h.codexes.length, 0); assert.equal(h.admission.store.requests().length, 1);
});

test('unconfirmed cards and uncertain patch acknowledgements cannot create replacements or work', async t => {
  const h = setup(t), request = h.admit(), owner = h.views();
  owner.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await owner.idle();
  const pending = h.interactions.transport.state.pending().find(r => r.taskView)!;
  assert.equal(owner.refresh({ kind: 'task-refresh', event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'om_unknown', id: pending.taskView!.id }), 'rejected');
  await h.interactions.transport.flush(); const card = h.sent.find(s => s.options?.taskView)!;
  h.fail(true); owner.refresh(click(card)); await owner.idle(); await h.interactions.transport.flush();
  const delivery = h.interactions.transport.state.pending(Date.now() + 100_000).find(r => r.taskView && r.updateMessage)!;
  assert.ok(delivery); h.fail(false);
  const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db')); db.prepare('UPDATE outbox SET next=0 WHERE id=?').run(delivery.id); db.close();
  await h.interactions.transport.flush(); assert.equal(h.updates.length, 2); assert.equal(h.updates[0]!.message, h.updates[1]!.message);
  assert.equal(h.sent.filter(s => s.options?.taskView).length, 1); assert.equal(h.codexes.length, 0);
});

test('sealed detail preserves journal bytes and card associations reject stale task controls', async t => {
  const h = setup(t), first = await h.start(); first.complete(); await first.running; await h.drain();
  const path = join(h.config.stateDirectory, 'executions', first.request.execution, 'bridge.db'), bytes = readFileSync(path);
  const owner = h.views(); owner.receive(message('/task ' + first.request.execution, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card.body.includes('原生封存证据已核对')); assert.deepEqual(readFileSync(path), bytes);
  const second = await h.start();
  h.interactions.receive(message('/stop', { chatType: 'p2p', parentId: 'om_' + card.id })); await h.drain();
  assert.equal(second.c.calls.filter(c => c.method === 'turn/interrupt').length, 0);
  const current = h.views(); current.receive(message('/task ' + second.request.execution, { chatType: 'p2p' })); await current.idle(); await h.interactions.transport.flush();
  const newer = h.sent.filter(s => s.options?.taskView).at(-1)!;
  h.interactions.receive(message('/stop', { chatType: 'p2p', parentId: 'om_' + newer.id })); await second.running;
  assert.equal(second.c.calls.filter(c => c.method === 'turn/interrupt').length, 1);
});

test('persistent task answer failure rolls back receipt and preserves idle/close and safe redelivery', async t => {
  const h = setup(t), owner = h.views(), state = h.interactions.transport.state, send = state.send.bind(state), query = message('/tasks', { chatType: 'p2p' });
  state.send = () => { throw Error('Synthetic persistent storage failure'); };
  owner.receive(query); await assert.doesNotReject(owner.idle()); state.send = send;
  owner.receive(query); owner.receive(query); await owner.idle(); await h.interactions.transport.flush();
  assert.equal(h.sent.filter(s => s.body.includes('任务概览')).length, 1); await assert.doesNotReject(h.interactions.close());
});

test('task presentation redacts request secrets before escaping and refresh preserves redaction', async t => {
  const secret = 'SECRET_with*markdown', h = setup(t, [secret]), request = h.admit('Inspect ' + secret), owner = h.views();
  owner.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card.body.includes('redacted')); assert.ok(!JSON.stringify(card).includes('SECRET'));
  owner.refresh(click(card)); await owner.idle(); await h.interactions.transport.flush(); assert.ok(!JSON.stringify(h.updates).includes('SECRET'));
});

test('task refresh SDK boundary validates application, actor, context and selector family', () => {
  const event = { schema: '2.0', app_id: 'app', host: 'im_message', event_id: 'event_1', tenant_key: 'tenant', operator: { tenant_key: 'tenant', open_id: 'ou_owner' },
    context: { open_chat_id: 'chat', open_message_id: 'om_card' }, action: { tag: 'button', value: { kind: 'task_progress', id: randomUUID() } } };
  assert.equal(normalizeTaskRefresh(event, 'app')!.kind, 'task-refresh');
  for (const change of [{ app_id: 'other' }, { host: 'other' }, { operator: { tenant_key: 'other', open_id: 'ou_owner' } }, { context: { open_chat_id: 'chat' } }, { action: { tag: 'button', value: { kind: 'codex_approval', id: event.action.value.id } } }]) assert.equal(normalizeTaskRefresh({ ...event, ...change }, 'app'), undefined);
});

test('actual SDK refresh dispatch and transport use only the confirmed card and patch endpoint', async t => {
  const p: TaskPresentation = { id: randomUUID(), execution: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', text: 'Snapshot' };
  const raw = { schema: '2.0', header: { event_id: 'refresh-1', app_id: 'cli_fixture', tenant_key: 'tenant', event_type: 'card.action.trigger' },
    host: 'im_message', context: { open_message_id: 'om_card', open_chat_id: 'chat' }, event: { operator: { open_id: 'ou_owner', tenant_key: 'tenant' },
      action: { tag: 'button', value: { kind: 'task_progress', id: p.id, command: '/stop' } } } };
  const f = new Feishu({ appId: 'cli_fixture', appSecret: 'fixture' }); t.after(() => f.close());
  let dispatcher: lark.EventDispatcher | undefined, received: TaskRefreshClick | undefined;
  const ws = Reflect.get(f, 'socket') as { start: (options: { eventDispatcher: lark.EventDispatcher }) => Promise<void>; onReady: () => void };
  t.mock.method(ws, 'start', async (options: { eventDispatcher: lark.EventDispatcher }) => { dispatcher = options.eventDispatcher; queueMicrotask(() => ws.onReady()); });
  await f.start(() => { throw Error('Refresh is not a task'); }, () => { throw Error('Refresh is not an approval'); }, click => { received = click; return 'accepted'; });
  const response = await dispatcher!.invoke(raw, { needCheck: false }); assert.ok(JSON.stringify(response).includes('正在读取任务进度'));
  assert.equal(received?.message, 'om_card'); assert.equal(received?.id, p.id); assert.equal(received?.kind, 'task-refresh');
  const calls: unknown[] = [];
  Object.assign(f, { client: { im: { v1: { message: { reply: async (input: unknown) => { calls.push(input); return { code: 0, data: { message_id: 'om_card' } }; },
    patch: async (input: unknown) => { calls.push(input); return { code: 0 }; }, create: async () => { throw Error('Replacement forbidden'); } } } } } });
  await f.send('chat', p.text, randomUUID(), { replyTo: 'om_query', taskView: p });
  assert.equal(record(record(calls[0]).data).msg_type, 'interactive'); assert.ok(String(record(record(calls[0]).data).content).includes('task_progress'));
  await f.updateTask('om_card', p); assert.deepEqual(record(calls[1]).path, { message_id: 'om_card' });
  Object.assign(f, { client: { im: { v1: { message: { patch: async () => { throw Error('Uncertain patch'); } } } } } });
  await assert.rejects(f.updateTask('om_card', p), /Uncertain patch/);
});

test('pilot command wiring admits no work and unknown outcomes preserve guards', async t => {
  const h = setup(t), task = await h.start(); task.c.exit(); await task.running;
  const before = h.admission.store.unsettled(), count = h.admission.store.requests().length;
  assert.equal(before[0]!.status, 'unknown');
  h.interactions.receive(message('/task ' + task.request.execution, { chatType: 'p2p' }));
  h.interactions.receive(message('/tasks', { chatType: 'p2p' })); await h.drain();
  const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card.body.includes('结果未确认')); assert.ok(card.body.includes('不解除保护'));
  assert.deepEqual(h.admission.store.unsettled(), before); assert.equal(h.admission.store.requests().length, count); assert.equal(h.codexes.length, 1);
  assert.ok(h.sent.some(s => s.body.startsWith('### 任务概览')));
  h.admission.store.reconcileLocal(randomUUID(), task.request.execution, 'Controlled fixture process/effect inspection');
  const queued = h.admit('New task after inspection');
  const page = h.admission.store.taskPage(JSON.stringify(['tenant', 'ou_owner', 'chat']), h.admission.project, 1);
  assert.equal(page.requests[0]!.execution, queued.execution);
  h.interactions.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await h.drain();
  assert.ok(h.sent.filter(s => s.options?.taskView).at(-1)!.body.includes('历史结果未确认（当前无执行保护）'));
  assert.equal(h.admission.store.execution(task.request.execution)!.status, 'unknown');
});

test('unreachable active owner stays unverified without changing grants or relaunching', async t => {
  const h = setup(t), task = await h.start(), path = join(h.config.stateDirectory, 'executions', task.request.execution, 'native-owner.json');
  const original = readFileSync(path), descriptor = JSON.parse(original.toString()), guards = h.admission.store.unsettled(), calls = task.c.calls.length;
  writeFileSync(path, JSON.stringify({ ...descriptor, socket: join(h.root, 'missing.sock') }));
  try {
    await assert.rejects(h.native.progress(task.request.execution));
    const owner = h.views(); owner.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
    const card = h.sent.find(s => s.options?.taskView)!; assert.ok(card.body.includes('当前执行器活动无法核实')); assert.ok(!card.body.includes('原生本轮已完成'));
    assert.deepEqual(h.admission.store.unsettled(), guards); assert.equal(task.c.calls.length, calls);
  } finally { writeFileSync(path, original); }
  task.complete(); await task.running;
});

test('sealed legacy task timing remains absent and the progress read does not migrate its journal', async t => {
  const h = setup(t), task = await h.start(); task.complete(); await task.running;
  const folder = join(h.config.stateDirectory, 'executions', task.request.execution), path = join(folder, 'bridge.db');
  // Construct a sealed legacy fixture with the original identity but without later timing columns or browser observations.
  const d = new DatabaseSync(path); d.exec('ALTER TABLE tasks DROP COLUMN execution_at; ALTER TABLE tasks DROP COLUMN finished_at; DROP TABLE browser_access_blocks'); d.close();
  const bytes = readFileSync(path), reportPath = join(folder, 'native-result.json'), report = JSON.parse(readFileSync(reportPath, 'utf8'));
  report.databaseHash = createHash('sha256').update(bytes).digest('hex'); writeFileSync(reportPath, JSON.stringify(report));
  const value = await h.native.progress(task.request.execution); assert.equal(value.live, false); assert.equal(value.accessBlocks, undefined); assert.equal(value.startedAt, undefined); assert.equal(value.finishedAt, undefined);
  assert.deepEqual(readFileSync(path), bytes);
});

test('copied text-only rich-post progress commands enter read-only query exactly once', async t => {
  const h = setup(t), request = h.admit(), command = '/task ' + request.execution;
  const raw = (content: unknown) => ({ tenant_key: 'tenant', sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: { message_id: randomUUID(), chat_id: 'chat', chat_type: 'p2p', message_type: 'post', content: JSON.stringify(content) } });
  for (const tag of ['text', 'md', 'code_block']) {
    const incoming = normalizeMessage(raw({ title: '', content: [[{ tag, text: command, style: ['code'] }]], content_v2: [[{ tag: 'md', text: command }]] }))!;
    assert.equal(incoming.text, command); assert.equal(incoming.unsupported, undefined);
    h.interactions.receive(incoming); h.interactions.receive(incoming); await h.drain();
  }
  assert.equal(h.sent.filter(s => s.options?.taskView).length, 3); assert.equal(h.admission.store.requests().length, 1); assert.equal(h.codexes.length, 0);
});

test('mixed rich posts and write controls stay unsupported with one useful private-owner reply', async t => {
  const h = setup(t), command = '/task ' + randomUUID();
  for (const content of [{ title: '', content: [[{ tag: 'text', text: '/stop' }]] }, { title: '', content: [[{ tag: 'text', text: command }, { tag: 'img', image_key: 'img_fixture' }]] },
    { title: 'Additional instructions', content: [[{ tag: 'text', text: command }]] }, { title: '', content: [[{ tag: 'a', text: command, href: 'https://example.invalid' }]] }]) {
    const incoming = normalizeMessage({ tenant_key: 'tenant', sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
      message: { message_id: randomUUID(), chat_id: 'chat', chat_type: 'p2p', message_type: 'post', content: JSON.stringify(content) } })!;
    assert.equal(incoming.unsupported, 'post'); h.interactions.receive(incoming); h.interactions.receive(incoming); await h.drain();
  }
  assert.equal(h.sent.filter(s => s.body.includes('暂不支持这类消息')).length, 4); assert.equal(h.admission.store.requests().length, 0); assert.equal(h.codexes.length, 0);
});

test('default task overview separates current work from at most three recent historical records', async t => {
  const h = setup(t);
  for (let i = 0; i < 8; i++) { const r = h.admit('Historical fixture ' + i); h.admission.store.withdraw(message('/withdraw ' + r.execution, { chatType: 'p2p' }), r.execution, h.admission.project); }
  const owner = h.views(); owner.receive(message('/tasks', { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
  const body = h.sent.at(-1)!.body;
  assert.ok(body.includes('执行中：0') && body.includes('未开始（含阻断）：0') && body.includes('待检查：0'));
  assert.equal((body.match(/\/task [0-9a-f-]{36}/g) ?? []).length, 3); assert.ok(body.includes('共 8 条') && body.includes('历史数量不代表当前待办'));
  const queued = h.admit('Current work'); owner.receive(message('/tasks', { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
  assert.ok(h.sent.at(-1)!.body.includes(queued.execution)); assert.ok(h.sent.at(-1)!.body.includes('未开始（含阻断）：1'));
});

const browserDenial = () => JSON.parse(readFileSync(new URL('./fixtures/browser-saved-denial.json', import.meta.url), 'utf8'));
const browserContinue = (execution: string) => `/browser-retry ${execution} local-change-confirmed`;
const journalBytes = (h: ReturnType<typeof setup>, execution: string) => readFileSync(join(h.config.stateDirectory, 'executions', execution, 'bridge.db'));
async function blockedBrowserTask(t: TestContext, text = 'Contact support about the pending review') {
  const h = setup(t), task = await h.start(h.admit(text));
  task.c.notify('item/completed', { ...task.current, item: browserDenial() });
  return { h, task };
}

test('browser observations survive settlement/restart, keep native completion distinct and publish one non-authorizing notice', async t => {
  const { h, task } = await blockedBrowserTask(t);
  const before = await h.native.progress(task.request.execution); assert.equal(before.accessBlocks?.length, 1);
  task.c.notify('item/completed', { ...task.current, item: browserDenial() });
  const live = await h.native.progress(task.request.execution); assert.deepEqual(live.accessBlocks, before.accessBlocks);
  assert.equal(task.c.replies.length, 0);
  task.complete(); await task.running; const bytes = journalBytes(h, task.request.execution); await h.drain();
  assert.equal(h.admission.store.execution(task.request.execution)!.status, 'completed');
  const notices = () => h.sent.filter(s => s.body.includes('浏览器站点权限观测'));
  assert.equal(notices().length, 1); assert.ok(notices()[0]!.body.includes('https://console.example.com'));
  assert.ok(notices()[0]!.body.includes(browserContinue(task.request.execution))); assert.equal(notices()[0]!.options?.approval, undefined);
  assert.ok(!notices()[0]!.body.includes('fixture-secret') && !notices()[0]!.body.includes('/private'));
  h.interactions.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await h.drain();
  const card = h.sent.filter(s => s.options?.taskView).at(-1)!;
  assert.ok(card.body.includes('原生本轮已完成') && card.body.includes('当前设置及任务交付结果仍需核对'));
  h.interactions.receive(message('/tasks', { chatType: 'p2p' })); await h.drain(); assert.ok(h.sent.at(-1)!.body.includes('浏览器站点权限拒绝'));
  await h.restart(); await h.drain(); assert.equal(notices().filter(s => !s.options?.taskView).length, 1);
  assert.deepEqual(journalBytes(h, task.request.execution), bytes); assert.equal(h.codexes.length, 1); assert.equal(h.admission.store.requests().length, 1);
});

test('verbal browser consent is scoped guidance and cannot mutate policy or create a model task', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  const count = h.admission.store.requests().length, bytes = journalBytes(h, task.request.execution);
  for (const fields of [{ user: 'other' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }]) {
    assert.equal(h.interactions.receive(message('允许浏览器工具访问', { chatType: 'p2p', ...fields })).status, 'rejected');
  }
  const allow = message('允许浏览器工具访问', { chatType: 'p2p' });
  h.interactions.receive(allow); await h.drain(); const replies = h.sent.filter(s => s.options?.replyTo === allow.id);
  assert.equal(replies.length, 1); assert.ok(replies[0]!.body.includes('这条消息没有保存授权，也没有启动任务'));
  h.interactions.receive(allow); await h.drain(); assert.equal(h.sent.filter(s => s.options?.replyTo === allow.id).length, 1);
  assert.equal(h.admission.store.requests().length, count); assert.equal(h.codexes.length, 1); assert.equal(task.c.replies.length, 0); assert.deepEqual(journalBytes(h, task.request.execution), bytes);
});

test('owner-attested browser continuation admits one linked fresh ordinary request under normal native policy', async t => {
  const h = setup(t);
  h.interactions.receive(message('/matter-new Original investigation', { chatType: 'p2p' }));
  const issued = h.interactions.receive(message('Contact support about the pending review', { chatType: 'p2p' }));
  assert.ok('request' in issued);
  const task = await h.start(issued.request);
  task.c.notify('item/completed', { ...task.current, item: browserDenial() });
  task.complete(); await task.running;
  h.interactions.receive(message('/matter-new Unrelated release', { chatType: 'p2p' }));
  await h.drain(); const bytes = journalBytes(h, task.request.execution);
  h.interactions.receive(message('/browser-retry ' + task.request.execution, { chatType: 'p2p' })); await h.drain(); assert.equal(h.admission.store.requests().length, 1);
  h.interactions.receive(message(browserContinue(task.request.execution), { user: 'other', chatType: 'p2p' })); await h.drain(); assert.equal(h.admission.store.requests().length, 1);
  const intent = message(browserContinue(task.request.execution), { chatType: 'p2p' }); h.interactions.receive(intent); await h.drain();
  const request = h.admission.store.browserRetryForSource(task.request.execution)!; assert.ok(request); assert.equal(h.admission.store.requests().length, 2);
  assert.equal(request.conversation, task.request.conversation); assert.ok(request.input.includes('Contact support') && request.input.includes('禁止重复提交'));
  assert.equal(h.admission.store.browserRetry(request.execution)!.sourceExecution, task.request.execution); assert.equal(h.admission.store.permissionRetry(request.execution), undefined);
  await h.restart(); h.interactions.receive(intent); h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
  assert.equal(h.admission.store.requests().length, 2); assert.equal(h.codexes.length, 1);
  const next = await h.start(request); assert.equal(next.c.calls.find(c => c.method === 'thread/resume')!.params.threadId, task.current.threadId);
  assert.ok(!next.c.calls.some(c => c.method === 'thread/approveGuardianDeniedAction')); assert.equal(next.c.replies.length, 0);
  next.c.notify('item/completed', { ...next.current, item: browserDenial() });
  next.complete(); await next.running; await h.drain();
  assert.equal(h.admission.store.requests().length, 2); assert.equal(h.codexes.length, 2);
  assert.equal((await h.native.progress(next.request.execution)).accessBlocks?.length, 1);
  h.interactions.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await h.drain();
  assert.ok(h.sent.filter(s => s.options?.taskView).at(-1)!.body.includes('/task ' + task.request.execution));
  assert.deepEqual(journalBytes(h, task.request.execution), bytes); assert.equal(h.admission.store.execution(task.request.execution)!.status, 'completed');
});

test('stale conversation, resource guard, maintenance and unknown source refuse browser continuation', async t => {
  for (const mode of ['stale', 'guarded', 'paused', 'unknown'] as const) await t.test(mode, async st => {
    const { h, task } = await blockedBrowserTask(st); task.complete(); await task.running; await h.drain();
    if (mode === 'stale') h.admit('A newer task');
    if (mode === 'guarded') {
      const newer = h.admission.store.accept(message('Held task', { user: 'other', chatType: 'p2p' }), 'Held task', h.admission.project);
      assert.ok('request' in newer); h.admission.store.reserve(newer.request.id, 90);
    }
    if (mode === 'paused') h.admission.store.maintenance.quiesce();
    if (mode === 'unknown') {
      const c = new DatabaseSync(join(h.config.stateDirectory, 'handoff.db')); c.prepare("UPDATE executions SET status='unknown' WHERE id=?").run(task.request.execution); c.close();
    }
    const before = h.admission.store.requests().length;
    h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
    assert.equal(h.admission.store.requests().length, before); assert.equal(h.admission.store.browserRetryForSource(task.request.execution), undefined); assert.equal(h.codexes.length, 1);
  });
});

test('admitted browser continuation revalidates sealed bytes before native startup', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain(); const request = h.admission.store.browserRetryForSource(task.request.execution)!;
  const path = join(h.config.stateDirectory, 'executions', task.request.execution, 'native-result.json'), before = readFileSync(path);
  const report = JSON.parse(before.toString()); report.checkpoint = randomUUID(); writeFileSync(path, JSON.stringify(report));
  const grant = h.admission.store.reserve(request.id, 90); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('No grant');
  await assert.rejects(h.native.run(grant.permit)); assert.equal(h.codexes.length, 1); writeFileSync(path, before);
});

test('out-of-order execution cannot resume a browser source after its conversation advanced', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain(); const request = h.admission.store.browserRetryForSource(task.request.execution)!;
  const newer = await h.start(h.admit('Newer independent work')); newer.complete(); await newer.running;
  const grant = h.admission.store.reserve(request.id, 90); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('No grant');
  await assert.rejects(h.native.run(grant.permit), /conversation advanced/); assert.equal(h.codexes.length, 2);
});

test('lost browser continuation receipt stays lookup-only across restart', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  const failure = t.mock.method(h.interactions.transport.state, 'send', () => { throw Error('Storage unavailable after admission'); });
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
  assert.ok(h.admission.store.browserRetryForSource(task.request.execution)); assert.equal(h.admission.store.requests().length, 2);
  failure.mock.restore(); await h.restart(); h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
  assert.equal(h.admission.store.requests().length, 2); assert.equal(h.codexes.length, 1); assert.ok(h.sent.at(-1)!.body.includes('没有再次创建'));
});

test('a source changing during asynchronous browser evidence inspection cannot admit a continuation', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  const projection = h.native.projection.bind(h.native); let resume!: () => void, waiting = false;
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const mocked = t.mock.method(h.native, 'projection', async (execution: string) => {
    const result = await projection(execution); if (execution === task.request.execution && !waiting) { waiting = true; await gate; } return result;
  });
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await until(() => waiting);
  h.admit('Newer task during source inspection'); resume(); await h.drain(); mocked.mock.restore();
  assert.equal(h.admission.store.requests().length, 2); assert.equal(h.admission.store.browserRetryForSource(task.request.execution), undefined);
  assert.ok(h.sent.some(s => s.body.includes('不满足续接条件，没有新建任务'))); assert.equal(h.codexes.length, 1);
});

test('browser notice and its receipt roll back together on storage failure and retry only delivery', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running;
  const state = h.interactions.transport.state, send = state.send.bind(state);
  const failed = t.mock.method(state, 'send', (...args: Parameters<typeof state.send>) => { if (args[1].includes('浏览器站点权限观测')) throw Error('Notice storage unavailable'); return send(...args); });
  await h.drain();
  const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'), { readOnly: true });
  assert.equal(db.prepare("SELECT count(*) n FROM projected_control_notices WHERE origin LIKE 'browser-access/%'").get()!.n, 0); db.close();
  assert.equal(h.sent.filter(s => s.body.includes('浏览器站点权限观测')).length, 0);
  failed.mock.restore(); await h.drain(); await h.restart(); await h.drain();
  assert.equal(h.sent.filter(s => s.body.includes('浏览器站点权限观测')).length, 1); assert.equal(h.codexes.length, 1); assert.equal(h.admission.store.requests().length, 1);
});

test('the admission transaction excludes verification and repair sources while admitting otherwise identical ordinary continuation', async t => {
  for (const kind of ['ordinary', 'verification', 'repair'] as const) await t.test(kind, async st => {
    const h = setup(st), profile = { projectRoot: h.admission.directory, engineRoot: h.admission.directory, projectId: 'fixture', suite: 'fixture',
      engineRevision: 'a'.repeat(40), cliHash: 'b'.repeat(64), libraryHash: 'c'.repeat(64), timeoutMs: 1000, policyFiles: {},
      ...(kind === 'repair' ? { repair: { scenarios: ['fixture'], timeoutMs: 1000 } } : {}) };
    const selected = h.admission.store.accept(message('Source work', { chatType: 'p2p' }), 'Source work', h.admission.project,
      kind === 'ordinary' ? undefined : { profile: 'fixture', definition: profile, ...(kind === 'repair' ? { repair: true as const } : {}) });
    assert.ok('request' in selected); const request = selected.request, grant = h.admission.store.reserve(request.id, 90);
    assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('No source grant');
    const attempt = kind === 'repair' ? h.admission.store.repairs.launch(grant.permit, 'native') : undefined;
    h.admission.store.nativeSnapshot(grant.permit, { thread: 'thread', turn: 'turn', generation: 'generation' }, attempt?.id);
    h.admission.store.terminal(grant.permit, 'completed', 'native-checkpoint/checkpoint');
    const result = h.admission.store.acceptBrowserRetry(message(browserContinue(request.execution), { chatType: 'p2p' }), request,
      { sourceExecution: request.execution, checkpoint: 'checkpoint', thread: 'thread', turn: 'turn', generation: 'generation',
        blocks: [{ task: 'task', item: 'item', generation: 'generation', browser: 'chrome', origin: 'https://console.example.com', code: 'persisted_user_denied', observedAt: Date.now() }] }, 'Check and continue unfinished work');
    assert.equal('rejected' in result, kind !== 'ordinary'); assert.equal(h.admission.store.requests().length, kind === 'ordinary' ? 2 : 1);
  });
});

test('browser progress is bounded and does not expose origin secrets or authorize hidden-target continuation', async t => {
  const h = setup(t, ['console.example.com']), task = await h.start();
  for (let i = 0; i < 12; i++) { const item = browserDenial(); item.id += '-' + i; task.c.notify('item/completed', { ...task.current, item }); }
  assert.equal((await h.native.progress(task.request.execution)).accessBlocks!.length, 10);
  task.complete(); await task.running; await h.drain();
  assert.ok(h.sent.every(s => !s.body.includes('console.example.com') && !s.body.includes('fixture-secret')));
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
  assert.equal(h.admission.store.requests().length, 1); assert.ok(h.sent.at(-1)!.body.includes('需脱敏内容'));
});

test('mobile task detail uses a complete short label with full original demand in a collapsed section', async t => {
  const full = '浏览器权限验收：请按 Chrome 技能在本轮建立连接，只读访问 https://appstoreconnect.apple.com/ 和 https://github.com/example/complete-repository 。分别报告最终域名、页面标题及访问结果，末尾加完整需求结束标记。';
  const h = setup(t), task = await h.start(h.admit(full)); task.complete(); await task.running; const bytes = journalBytes(h, task.request.execution);
  h.interactions.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await h.drain();
  const p = h.sent.find(s => s.options?.taskView)!.options!.taskView!, l = p.layout!;
  assert.equal(l.title, '浏览器权限验收'); assert.equal(l.heading, '本轮已结束'); assert.ok(l.summary.includes('业务结果以最终回复为准'));
  assert.ok(l.panels.find(p => p.title === '原始需求（展开全文）')!.text.includes(full));
  assert.ok(!JSON.stringify(taskCard(p).header).includes('任务已完成'));
  assert.deepEqual(journalBytes(h, task.request.execution), bytes); assert.equal(h.admission.store.requests().length, 1);
});

test('long original demand has an explicit bounded disclosure instead of silent title truncation', async t => {
  const full = 'Inspect ' + 'long demand '.repeat(200) + 'ORIGINAL_END_MARKER', h = setup(t), request = h.admit(full);
  h.interactions.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await h.drain();
  const l = h.sent.find(s => s.options?.taskView)!.options!.taskView!.layout!;
  assert.ok(l.title.endsWith('…')); assert.ok(l.panels[0]!.title.includes('前 2000 字'));
  assert.ok(l.panels[0]!.text.includes('已明确省略')); assert.ok(h.admission.store.request(request.id)!.input.endsWith('ORIGINAL_END_MARKER'));
  assert.equal(h.codexes.length, 0);
});

test('same-card refresh updates structured queue, running and terminal headers without extra task admission', async t => {
  const h = setup(t), request = h.admit('Inspect the project'), owner = h.views();
  owner.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; assert.equal(card.options!.taskView!.layout!.heading, '排队中');
  const task = await h.start(request); owner.refresh(click(card)); await owner.idle(); await h.interactions.transport.flush();
  assert.equal(h.updates.at(-1)!.p.layout!.heading, '正在执行');
  task.complete(); await task.running; owner.refresh(click(card)); await owner.idle(); await h.interactions.transport.flush();
  assert.equal(h.updates.at(-1)!.p.layout!.heading, '本轮已结束');
  assert.ok(h.updates.every(x => x.message === 'om_' + card.id && x.p.id === card.options!.taskView!.id));
  assert.equal(h.admission.store.requests().length, 1); assert.equal(h.codexes.length, 1);
});

test('a historical browser refusal with a linked continuation stays concise without repeating local grant instructions', async t => {
  const { h, task } = await blockedBrowserTask(t); task.complete(); await task.running; await h.drain();
  h.interactions.receive(message(browserContinue(task.request.execution), { chatType: 'p2p' })); await h.drain();
  const next = h.admission.store.browserRetryForSource(task.request.execution)!;
  h.interactions.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await h.drain();
  const l = h.sent.filter(s => s.options?.taskView).at(-1)!.options!.taskView!.layout!;
  assert.equal(l.heading, '本轮已结束'); assert.equal(l.tone, 'grey'); assert.ok(l.summary.includes('关联续接'));
  const history = l.panels.find(p => p.title === '历史访问记录与关联续接')!;
  assert.ok(history.text.includes(next.execution) && history.text.includes('历史工具观测'));
  assert.ok(!history.text.includes('Settings') && !history.text.includes('/browser-retry'));
});

test('a source-routing block is not presented as a runnable queued task', async t => {
  const h = setup(t), request = h.admit('Inspect the project'); h.admission.store.routed(request.id, false);
  h.interactions.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await h.drain();
  const l = h.sent.find(s => s.options?.taskView)!.options!.taskView!.layout!;
  assert.equal(l.heading, '尚未开始'); assert.equal(l.tone, 'orange'); assert.ok(l.summary.includes('已阻断'));
  assert.equal(h.admission.store.requests().length, 1); assert.equal(h.codexes.length, 0);
});

test('a URL inside a request is not mistaken for a topic delimiter', async t => {
  const h = setup(t), request = h.admit('Read https://github.com/example/project and report the page title');
  h.interactions.receive(message('/task ' + request.execution, { chatType: 'p2p' })); await h.drain();
  const l = h.sent.find(s => s.options?.taskView)!.options!.taskView!.layout!;
  assert.ok(l.title.includes('github.com')); assert.ok(!l.title.includes('https'));
  assert.ok(l.panels[0]!.text.includes('https://github.com/example/project'));
  assert.equal(h.codexes.length, 0);
});

test('task detail redacts Markdown-sensitive secrets in browser origins before persistence and on refresh', async t => {
  const secret = 'fixture_secret', h = setup(t, [secret]), task = await h.start(), item = browserDenial();
  item.result._meta.browser_use.url = 'https://' + secret + '.example.com/private';
  task.c.notify('item/completed', { ...task.current, item }); task.complete(); await task.running; await h.drain();
  const owner = h.views(); owner.receive(message('/task ' + task.request.execution, { chatType: 'p2p' })); await owner.idle();
  const stored = h.interactions.transport.state.pending().find(d => d.taskView)!.taskView!;
  const inspect = (p: TaskPresentation) => {
    for (const text of [JSON.stringify(p), JSON.stringify(taskCard(p))]) { assert.ok(!text.includes(secret)); assert.ok(!text.includes('fixture\\_secret')); }
    assert.ok(p.layout!.panels.find(p => p.title.includes('浏览器'))!.text.includes('redacted'));
  };
  inspect(stored); await h.interactions.transport.flush();
  const card = h.sent.find(s => s.options?.taskView)!; inspect(card.options!.taskView!);
  owner.refresh(click(card)); await owner.idle(); await h.interactions.transport.flush(); inspect(h.updates.at(-1)!.p);
  assert.equal(h.admission.store.requests().length, 1); assert.equal(h.codexes.length, 1);
});
