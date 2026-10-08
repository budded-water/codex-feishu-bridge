import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import lockfile from 'proper-lockfile';
import { State } from '../src/state.js';
import { Outbox } from '../src/outbox.js';
import { message } from './helpers.js';

test('routing clarification and diagnostics survive reopen without replaying handed-off work', t => {
  const directory = mkdtempSync(join(tmpdir(), 'routing-state-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  let state = new State(directory);
  const actor = message('Query users'); const first = state.select(actor, '$chat', directory);
  state.setRouting(first.owner, 'router-thread', 'Query users', { id: 'original-message', chatType: 'group', parentId: 'quoted', createTime: '1000' });
  state.close(); state = new State(directory);
  assert.deepEqual({ ...state.routing(first.owner) }, { thread: 'router-thread', pending: 'Query users', source: { id: 'original-message', chatType: 'group', parentId: 'quoted', createTime: '1000' } });
  const task = state.enqueue(first.id, actor.text);
  state.taskStatus(task.id, 'running');
  state.diagnostic(task.id, 'Bridge rejected unsupported/toolApproval');
  const target = state.select(actor, 'alpha', directory);
  state.transaction(() => {
    state.clearPending(first.owner);
    state.routeTask(task.id, target.id, 'Query users\nUser clarified alpha');
  });
  state.close(); state = new State(directory);
  assert.deepEqual({ ...state.routing(first.owner) }, { thread: 'router-thread', pending: null });
  assert.equal(Boolean(state.queued(directory)!.routed), true);
  assert.match(state.latestDiagnostic(target.id)!, /Bridge rejected/);
  assert.equal(state.routing(JSON.stringify(['tenant', 'different-user', 'chat'])), undefined);
  assert.equal(state.recover(), 1); assert.equal(state.queued(directory), undefined);
  state.close();
});

test('restart preserves threads and deduplication while stopping unfinished work exactly once', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-state-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let state = new State(directory);
  const input = message('Work');
  const session = state.select(input, 'project', directory);
  state.remember(input);
  state.setThread(session.id, 'persisted-thread');
  const running = state.enqueue(session.id, 'Running');
  state.taskStatus(running.id, 'running', 'turn-1');
  state.enqueue(session.id, 'Queued');
  state.close();
  state = new State(directory);
  assert.equal(state.selected(input)!.thread, 'persisted-thread');
  assert.equal(state.remember(input), false);
  assert.equal(state.recover(), 2);
  assert.equal(state.recover(), 0);
  assert.deepEqual(state.status(session.id).map(row => ({ ...row })), [{ status: 'interrupted', count: 2 }]);
  assert.equal(state.queued(directory), undefined);
  state.close();
  assert.equal(statSync(join(directory, 'bridge.db')).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
});

test('delivery retries use the same UUID, preserve chat order, and cannot repeat a completed task', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-delivery-test-'));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = state.select(message('Work'), 'project', directory);
  const task = state.enqueue(session.id, 'Work');
  state.taskStatus(task.id, 'completed');
  state.send('chat', 'first secret-test-value');
  state.send('chat', 'second');
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const sent: { body: string; key: string }[] = [];
  const outbox = new Outbox(state, {
    async send(_chat, body, key) {
      sent.push({ body, key });
      if (sent.length === 1) throw new Error('Network failure');
    },
  }, ['secret-test-value']);
  await outbox.flush();
  assert.equal(sent[0]!.body, 'first [redacted]');
  await outbox.flush(); assert.equal(sent.length, 1);
  now += 10_000;
  await outbox.flush();
  assert.equal(sent[0]!.key, sent[1]!.key);
  await outbox.flush();
  assert.equal(sent[2]!.body, 'second');
  assert.deepEqual(state.status(session.id).map(row => ({ ...row })), [{ status: 'completed', count: 1 }]);
  assert.equal(state.queued(directory), undefined);
});

test('concurrent flushes cannot duplicate a delivery and failed transactions roll back deduplication', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-atomic-test-'));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const input = message('Work');
  assert.throws(() => state.transaction(() => { state.remember(input); throw new Error('Crash'); }));
  assert.equal(state.remember(input), true);
  state.send('chat', 'once');
  let count = 0;
  const outbox = new Outbox(state, { async send() { count++; await new Promise(resolve => setTimeout(resolve, 10)); } });
  await Promise.all([outbox.flush(), outbox.flush(), outbox.flush()]);
  assert.equal(count, 1);
});

test('long Unicode results are split without corrupting characters', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-unicode-test-'));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const body = '🙂你好'.repeat(2500);
  state.send('chat', body);
  let actual = '';
  while (state.pending().length) {
    const delivery = state.pending()[0]!;
    assert.ok(Buffer.byteLength(delivery.body) <= 12_000);
    actual += delivery.body; state.delivered(delivery.id);
  }
  assert.equal(actual, body);
});

test('a second process cannot own the same state lock', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-lock-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const release = await lockfile.lock(directory, { retries: 0 });
  try { await assert.rejects(lockfile.lock(directory, { retries: 0 }), /already being held/); }
  finally { await release(); }
});


test('legacy approval audit migrates once and records the deciding team actor without losing history', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-approval-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'bridge.db');
  let db = new DatabaseSync(filename);
  db.exec("CREATE TABLE approvals (id TEXT PRIMARY KEY, task TEXT, method TEXT, status TEXT, created INTEGER); INSERT INTO approvals VALUES ('old', 'task', 'method', 'decline_sent', 1)");
  db.close();
  let state = new State(directory);
  state.recordApproval('new', 'task', 'method');
  state.approvalStatus('new', 'accept_sent', 'ou_admin');
  state.close();
  state = new State(directory); state.close();
  db = new DatabaseSync(filename);
  t.after(() => db.close());
  assert.deepEqual(db.prepare('SELECT id, status, actor FROM approvals ORDER BY created').all().map(row => ({ ...row })), [
    { id: 'old', status: 'decline_sent', actor: null }, { id: 'new', status: 'accept_sent', actor: 'ou_admin' },
  ]);
});


test('queued trigger metadata survives reopen without fetching or changing the original request', t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-trigger-metadata-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let state = new State(directory);
  const session = state.select(message('Work'), 'project', directory);
  const source = { id: 'trigger', chatType: 'group' as const, createTime: '1791400000000', parentId: 'quoted' };
  state.enqueue(session.id, 'What do you think?', source); state.close();
  state = new State(directory); t.after(() => state.close());
  assert.deepEqual(state.queued(directory)!.source, source);
  assert.equal(state.queued(directory)!.input, 'What do you think?');
});


test('a selected status is discarded if its task completes while another chat delivery waits', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-stale-status-test-'));
  const state = new State(directory);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = state.select(message('Work'), 'project', directory);
  const task = state.enqueue(session.id, 'Work');
  state.send('other-chat', 'Other delivery');
  state.sendStatus(task.id, 'chat', 'Stale waiting notice');
  let release!: () => void;
  const sent: string[] = [];
  const outbox = new Outbox(state, { async send(chat, body) {
    if (chat === 'other-chat') await new Promise<void>(done => { release = done; });
    sent.push(body);
  } });
  const pending = outbox.flush();
  state.taskStatus(task.id, 'completed');
  state.send('chat', 'Final answer');
  release(); await pending; await outbox.flush();
  assert.deepEqual(sent, ['Other delivery', 'Final answer']);
  assert.deepEqual(state.pending(), []);
});


test('known secrets crossing reply boundaries are redacted before persistence and delivery', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-redaction-boundary-test-'));
  const secret = 'fictional-known-gateway-secret';
  const state = new State(directory, [secret]);
  t.after(() => { state.close(); rmSync(directory, { recursive: true, force: true }); });
  const session = state.select(message('Work'), 'project', directory);
  const task = state.enqueue(session.id, 'Work');
  const body = 'a'.repeat(2470) + secret + 'z'.repeat(100);
  state.send('chat', body);
  state.sendStatus(task.id, 'status-chat', `Received ${secret}`);
  const stored = state.pending().map(row => row.body).join('');
  assert.ok(!stored.includes(secret));
  const db = new DatabaseSync(join(directory, 'bridge.db'));
  try {
    const persisted = (db.prepare('SELECT body FROM outbox ORDER BY sequence').all() as { body: string }[]).map(row => row.body).join('');
    assert.ok(!persisted.includes(secret));
    assert.ok(persisted.includes('[redacted]'));
  } finally { db.close(); }
  const sent: string[] = [];
  const outbox = new Outbox(state, { async send(_chat, text) { sent.push(text); } }, [secret]);
  while (state.pending().length) await outbox.flush();
  assert.equal(sent.filter(text => text.startsWith('a') || text.startsWith('z')).join(''), 'a'.repeat(2470) + '[redacted]' + 'z'.repeat(100));
  assert.ok(!sent.join('').includes(secret));
  assert.ok(sent.includes('Received [redacted]'));
});
