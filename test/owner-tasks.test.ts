import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as lark from '@larksuiteoapi/node-sdk';
import { Feishu } from '../src/feishu.js';
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
  for (const text of ['/tasks', '/tasks 2', '/tasks 3', '/tasks 0', '/task ' + randomUUID()]) { owner.receive(message(text, { chatType: 'p2p' })); await owner.idle(); await h.interactions.transport.flush(); }
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
  assert.equal(h.sent.filter(s => s.body.includes('任务列表')).length, 1); await assert.doesNotReject(h.interactions.close());
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
  assert.ok(h.sent.some(s => s.body.startsWith('### 任务列表')));
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
  // Construct a sealed legacy fixture with the original identity but without later timing columns.
  const d = new DatabaseSync(path); d.exec('ALTER TABLE tasks DROP COLUMN execution_at; ALTER TABLE tasks DROP COLUMN finished_at'); d.close();
  const bytes = readFileSync(path), reportPath = join(folder, 'native-result.json'), report = JSON.parse(readFileSync(reportPath, 'utf8'));
  report.databaseHash = createHash('sha256').update(bytes).digest('hex'); writeFileSync(reportPath, JSON.stringify(report));
  const value = await h.native.progress(task.request.execution); assert.equal(value.live, false); assert.equal(value.startedAt, undefined); assert.equal(value.finishedAt, undefined);
  assert.deepEqual(readFileSync(path), bytes);
});
