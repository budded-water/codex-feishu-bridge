import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Feedback } from '../src/feedback.js';
import { State } from '../src/state.js';
const LONG_WAIT_MS = 30_000; // Simulate the former notice threshold; waiting must stay quiet.
import { setup, message, until } from './helpers.js';

function store(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'codex-feedback-'));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = state.select(message(''), 'project', directory);
  const task = state.enqueue(session.id, 'Request', { id: 'original' });
  return { state, task, session, directory };
}

test('authorized unique task receives one reaction; completion removes only its saved reaction', async t => {
  const h = setup(); t.after(h.close); h.deliveries();
  const calls: string[] = [];
  const feedback = new Feedback(h.state, {
    async addReaction(id) { calls.push(`add:${id}`); return 'own-reaction'; },
    async findReaction() { throw new Error('Unexpected listing'); },
    async removeReaction(id, reaction) { calls.push(`remove:${id}:${reaction}`); },
  });
  const input = message('Read', { id: 'original' });
  h.bridge.receive(input); h.bridge.receive(input);
  h.bridge.receive(message('Forbidden', { user: 'ou_unlisted' }));
  h.bridge.receive(message('/status'));
  await feedback.flush(); await feedback.flush();
  assert.deepEqual(calls, ['add:original']);
  await until(() => h.turns().length === 1);
  const active = h.current(); h.codex.complete(active.threadId, active.turnId);
  await feedback.flush(); await feedback.flush();
  assert.deepEqual(calls, ['add:original', 'remove:original:own-reaction']);
  assert.equal(h.turns().length, 1);
});

test('late reaction creation after completion is cleaned without an acknowledgment after the answer', async t => {
  const { state, task } = store(t);
  let resolve!: (id: string) => void;
  const deleted: string[] = [];
  const feedback = new Feedback(state, {
    addReaction() { return new Promise(done => { resolve = done; }); },
    async findReaction() { return undefined; },
    async removeReaction(_message, id) { deleted.push(id); },
  });
  const flush = feedback.flush();
  state.taskStatus(task.id, 'completed'); resolve('late'); await flush;
  assert.deepEqual(deleted, ['late']);
  assert.equal(state.feedback(task.id), undefined);
  assert.deepEqual(state.pending(), []);
});

test('ambiguous add failure falls back once and reconciles ownership before cleanup without replay', async t => {
  const { state, task } = store(t);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  let adds = 0; let lists = 0; let removes = 0;
  const feedback = new Feedback(state, {
    async addReaction() { adds++; throw new Error('Response lost'); },
    async findReaction() { lists++; return 'accepted-but-response-lost'; },
    async removeReaction(_message, id) { assert.equal(id, 'accepted-but-response-lost'); removes++; },
  });
  await feedback.flush(); await feedback.flush();
  assert.equal(adds, 1); assert.equal(state.pending().length, 1);
  state.taskStatus(task.id, 'unknown'); now += 5000;
  await feedback.flush(); await feedback.flush();
  assert.equal(adds, 1); assert.equal(lists, 1); assert.equal(removes, 1);
  assert.equal(state.feedback(task.id), undefined);
  assert.deepEqual(state.pending(), []); // stale fallback suppressed
});

test('restart cleans a persisted reaction for interrupted work and retries failed deletion', async t => {
  const { state, directory, task } = store(t);
  state.feedbackAdded(task.id, 'persisted');
  const reopened = new State(directory); t.after(() => reopened.close());
  assert.equal(reopened.recover(), 1);
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  let tries = 0;
  const feedback = new Feedback(reopened, {
    async addReaction() { throw new Error('Must not re-add'); },
    async findReaction() { throw new Error('Known id'); },
    async removeReaction(_message, id) { assert.equal(id, 'persisted'); if (++tries === 1) throw new Error('Offline'); },
  });
  await feedback.flush(); assert.equal(reopened.feedback(task.id)!.reaction, 'persisted');
  await feedback.flush(); assert.equal(tries, 1);
  now += 5000; await feedback.flush(); assert.equal(tries, 2);
  assert.equal(reopened.feedback(task.id), undefined);
  assert.equal(reopened.queued(directory), undefined);
});

test('cancelled queued work with no attempted reaction never creates one', async t => {
  const { state, task, session } = store(t);
  state.cancelSessionQueued(session.id);
  const feedback = new Feedback(state, {
    async addReaction() { throw new Error('Must not add'); },
    async findReaction() { throw new Error('No uncertain HTTP request'); },
    async removeReaction() { throw new Error('No reaction'); },
  });
  await feedback.flush(); assert.equal(state.feedback(task.id), undefined);
});

test('long wait stays quiet; on-demand status and a single final answer remain available', async t => {
  const h = setup(); t.after(h.close); h.deliveries();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  h.bridge.receive(message('Explain')); await setImmediate();
  const active = h.current();
  t.mock.timers.tick(LONG_WAIT_MS - 1); assert.deepEqual(h.deliveries(), []);
  t.mock.timers.tick(1);
  assert.deepEqual(h.deliveries(), []);
  h.bridge.receive(message('/status'));
  assert.ok(h.deliveries()[0]!.includes('等待 Codex'));
  t.mock.timers.tick(LONG_WAIT_MS * 3); assert.deepEqual(h.deliveries(), []);
  h.codex.complete(active.threadId, active.turnId, 'completed', 'Answer');
  assert.equal(h.deliveries().filter(body => body.startsWith('Answer')).length, 1);
  t.mock.timers.tick(LONG_WAIT_MS * 3); assert.deepEqual(h.deliveries(), []);
});

test('waiting for group context is reported honestly before Codex starts', async t => {
  let resolve!: (value: { status: 'available'; messages: []; note: string }) => void;
  const h = setup({ context() { return new Promise(done => { resolve = done; }); } });
  t.after(h.close); h.config.groupContextMessages = 50; h.deliveries();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  h.bridge.receive(message('Question', { chatType: 'group' })); await setImmediate();
  t.mock.timers.tick(LONG_WAIT_MS);
  assert.deepEqual(h.deliveries(), []); assert.equal(h.turns().length, 0);
  h.bridge.receive(message('/status')); assert.ok(h.deliveries()[0]!.includes('尚未收到本次 Codex 事件'));
  resolve({ status: 'available', messages: [], note: '' }); await setImmediate();
  h.codex.complete(h.current().threadId, h.current().turnId);
});

test('queue notice, approval wait and process exit never pretend the model is thinking', async t => {
  const h = setup(); t.after(h.close); h.deliveries();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  h.bridge.receive(message('First')); await setImmediate();
  const active = h.current();
  h.bridge.receive(message('Second')); assert.ok(h.deliveries()[0]!.includes('前一个请求'));
  h.codex.ask('approval', 'item/commandExecution/requestApproval', { ...active, command: 'echo bounded' }); h.deliveries();
  t.mock.timers.tick(LONG_WAIT_MS);
  assert.deepEqual(h.deliveries(), []);
  h.bridge.receive(message('/status'));
  const notices = h.deliveries().join('\n');
  assert.ok(notices.includes('等待管理员审批')); assert.ok(notices.includes('queued'));
  h.codex.exit(); const ended = h.deliveries().join('\n'); assert.ok(ended.includes('进程退出'));
  t.mock.timers.tick(LONG_WAIT_MS * 3); assert.deepEqual(h.deliveries(), []);
  assert.equal(h.turns().length, 1);
});

test('reaction adapter uses native OnIt and reconciles only this app across pages', async t => {
  const { Feishu } = await import('../src/feishu.js');
  const adapter = new Feishu({ appId: 'this-app', appSecret: 'fake-secret' });
  t.after(() => adapter.close());
  const creates: unknown[] = []; const deletes: unknown[] = []; const pages: unknown[] = [];
  Object.assign(adapter, { client: { im: { v1: { messageReaction: {
    create: async (request: unknown) => { creates.push(request); return { code: 0, data: { reaction_id: 'own' } }; },
    list: async (request: unknown) => {
      pages.push(request);
      return pages.length === 1 ? { code: 0, data: { items: [
        { reaction_id: 'human', operator: { operator_type: 'user', operator_id: 'this-app' }, reaction_type: { emoji_type: 'OnIt' } },
        { reaction_id: 'other', operator: { operator_type: 'app', operator_id: 'other-app' }, reaction_type: { emoji_type: 'OnIt' } },
      ], has_more: true, page_token: 'next' } } : { code: 0, data: { items: [
        { reaction_id: 'own', operator: { operator_type: 'app', operator_id: 'this-app' }, reaction_type: { emoji_type: 'OnIt' } },
      ], has_more: false } };
    },
    delete: async (request: unknown) => { deletes.push(request); return { code: 0 }; },
  } } } } });
  assert.equal(await adapter.addReaction('original'), 'own');
  assert.equal(await adapter.findReaction('original'), 'own');
  await adapter.removeReaction('original', 'own');
  assert.deepEqual(creates, [{ path: { message_id: 'original' }, data: { reaction_type: { emoji_type: 'OnIt' } } }]);
  assert.deepEqual(deletes, [{ path: { message_id: 'original', reaction_id: 'own' } }]);
  assert.equal(pages.length, 2);
});

test('reaction HTTP errors cannot block the independent durable final answer', async t => {
  const { state, task } = store(t);
  const { Outbox } = await import('../src/outbox.js');
  let release!: () => void;
  const feedback = new Feedback(state, {
    async addReaction() { await new Promise<void>(done => { release = done; }); throw new Error('Offline'); },
    async findReaction() { return undefined; }, async removeReaction() {},
  });
  const pending = feedback.flush();
  state.taskStatus(task.id, 'completed'); state.send('chat', 'Final answer');
  const delivered: string[] = [];
  const outbox = new Outbox(state, { async send(_chat, body) { delivered.push(body); } });
  await outbox.flush(); assert.deepEqual(delivered, ['Final answer']);
  release(); await pending; assert.deepEqual(state.pending(), []);
});


test('HTTP not-found after a lost delete response completes cleanup without exposing SDK details', async t => {
  const { Feishu } = await import('../src/feishu.js');
  const adapter = new Feishu({ appId: 'this-app', appSecret: 'fake-secret' });
  t.after(() => adapter.close());
  Object.assign(adapter, { client: { im: { v1: { messageReaction: {
    delete: async () => { throw { response: { data: { code: 231011, msg: 'private SDK details' } } }; },
    list: async () => { throw { response: { data: { code: 231003 } } }; },
  } } } } });
  await adapter.removeReaction('original', 'gone');
  assert.equal(await adapter.findReaction('original'), undefined);
});
