import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as lark from '@larksuiteoapi/node-sdk';
import { approvalCard, normalizeApprovalClick, type ApprovalClick } from '../src/approval.js';
import { Outbox } from '../src/outbox.js';
import { State } from '../src/state.js';
import { Feishu } from '../src/feishu.js';
import { record } from '../src/types.js';
import { message, setup, until } from './helpers.js';
import { journalProjection } from '../src/handoff/journal.js';
import type { DeliveryOptions } from '../src/types.js';

async function pending(t: import('node:test').TestContext, command = 'printf "literal `code`"', reason = 'Inspect the exact local operation') {
  const h = setup(); t.after(h.close); h.deliveries(); h.config.projectRouting = 'workspace';
  h.bridge.receive(message('Task input with a long duplicate /private/project/path', { chatType: 'p2p' })); await until(() => h.turns().length === 1);
  h.codex.ask('approval', 'item/commandExecution/requestApproval', { ...h.current(), command, reason });
  const delivery = h.state.pending().find(row => row.approval)!; assert.ok(delivery?.approval);
  const p = delivery.approval;
  const click = (changes: Partial<ApprovalClick> = {}): ApprovalClick => ({ event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'om_card', id: p.id, decision: 'approve', ...changes });
  return { ...h, p, delivery, click };
}

test('card has an exact fenced action and one-request controls without duplicated task text, internal alias or self mention', async t => {
  const h = await pending(t); const card = JSON.stringify(approvalCard(h.p));
  assert.ok(card.includes('操作确认') && card.includes('批准本次') && card.includes('拒绝') && card.includes('通用工作区'));
  assert.ok(card.includes(JSON.stringify(h.p.action).slice(1, -1))); assert.ok(card.includes('仅授权本次动作'));
  assert.ok(!card.includes('duplicate /private/project/path') && !card.includes('[[notify:') && !card.includes('项目：alpha'));
  assert.ok(h.delivery.body.includes('/approve ' + h.p.prompt) && h.delivery.body.includes('/reject ' + h.p.prompt));
  assert.ok(!JSON.stringify(approvalCard(h.p, 'approved')).includes('behaviors')); assert.ok(JSON.stringify(approvalCard(h.p, 'approved')).includes('执行结果以任务回复为准'));
});

test('only an acknowledged matching card and authorized actor can decide the exact live native prompt once', async t => {
  const h = await pending(t); assert.equal(h.bridge.cardAction(h.click()), 'rejected'); assert.equal(h.codex.replies.length, 0);
  h.state.delivered(h.delivery.id, 'om_card');
  for (const change of [{ user: 'ou_other' }, { tenant: 'other' }, { chat: 'other' }, { message: 'om_foreign' }, { id: randomUUID() }]) {
    assert.equal(h.bridge.cardAction(h.click(change)), 'rejected');
  }
  const click = h.click(); assert.equal(h.bridge.cardAction(click), 'accepted');
  assert.deepEqual(h.codex.replies, [{ id: 'approval', result: { decision: 'accept' } }]);
  assert.equal(h.bridge.cardAction(click), 'rejected'); assert.equal(h.bridge.cardAction(h.click({ decision: 'reject' })), 'rejected');
  assert.equal(h.codex.replies.length, 1); assert.equal(h.turns().length, 1); assert.equal(Number(h.state.drainStatus().outbox) >= 1, true);
  for (const row of h.state.pending()) if (!row.updateMessage) { assert.equal(row.replyTo, 'om_card'); h.state.delivered(row.id); }
  const update = h.state.pending().find(row => row.updateMessage)!; assert.equal(update.updateMessage, 'om_card'); assert.equal(update.approvalView, 'approved');
});

test('expiry, interruption and a newer native turn cannot give an old card authority', async t => {
  const h = await pending(t); h.state.delivered(h.delivery.id, 'om_card');
  h.codex.complete(h.current().threadId, h.current().turnId); h.bridge.receive(message('Fresh task', { chatType: 'p2p' })); await until(() => h.turns().length === 2);
  assert.equal(h.bridge.cardAction(h.click()), 'rejected'); assert.equal(h.codex.replies.length, 0);
  h.deliveries();
  const newer = h.current(); h.codex.ask('new-approval', 'item/commandExecution/requestApproval', { ...newer, command: 'echo newer' });
  assert.equal(h.bridge.cardAction(h.click()), 'rejected'); assert.equal(h.codex.replies.length, 0);
  const delivery = h.state.pending().find(row => row.approval && !row.updateMessage)!; assert.ok(delivery?.approval);
  h.state.delivered(delivery.id, 'om_new'); const now = Date.now(); t.mock.method(Date, 'now', () => now + 301_000);
  assert.equal(h.bridge.cardAction(h.click({ id: delivery.approval.id, message: 'om_new' })), 'rejected');
  const expired = []; for (;;) { const rows = h.state.pending(); if (!rows.length) break; expired.push(...rows); for (const row of rows) h.state.delivered(row.id); }
  assert.equal(expired.find(row => row.updateMessage === 'om_new')!.approvalView, 'expired');
});

test('lost initial acknowledgement rejects clicks; durable update retries target the same message after reopen', async t => {
  const h = await pending(t); let fail = true; const sent: string[] = [], updates: string[] = [];
  const texts: string[] = [];
  const sender = { send: async (_chat: string, text: string, id: string, options?: DeliveryOptions) => {
    assert.ok(!options?.replyTo?.startsWith('card/')); texts.push(text); sent.push(id); if (fail) throw Error('uncertain'); return 'om_card'; },
    updateApproval: async (id: string) => { updates.push(id); if (fail) throw Error('update uncertain'); } };
  const outbox = new Outbox(h.state, sender); await outbox.flush(); assert.equal(h.bridge.cardAction(h.click()), 'rejected');
  const db = new DatabaseSync(join(h.config.stateDirectory, 'bridge.db')); db.prepare('UPDATE outbox SET next=0').run(); db.close(); fail = false; await outbox.flush();
  assert.deepEqual(sent, [h.delivery.id, h.delivery.id]); assert.equal(h.bridge.cardAction(h.click({ decision: 'reject' })), 'accepted');
  assert.deepEqual(h.codex.replies.at(-1), { id: 'approval', result: { decision: 'decline' } });
  await outbox.flush(); // The decision acknowledgment precedes its card update in this chat.
  fail = true; await outbox.flush(); assert.deepEqual(updates, ['om_card']);
  const retry = h.state.pending(Number.MAX_SAFE_INTEGER).find(row => row.updateMessage)!; assert.ok(retry);
  const transport = new State(h.config.stateDirectory); t.after(() => transport.close());
  const reopened = transport.pending(Number.MAX_SAFE_INTEGER).find(row => row.updateMessage)!; assert.equal(reopened.id, retry.id); assert.equal(reopened.approvalView, 'rejected');
  const db2 = new DatabaseSync(join(h.config.stateDirectory, 'bridge.db')); db2.prepare('UPDATE outbox SET next=0').run(); db2.close(); fail = false; await new Outbox(transport, sender).flush();
  assert.deepEqual(updates, ['om_card', 'om_card']); assert.equal(h.codex.replies.length, 1); assert.equal(transport.drainStatus().outbox, 0);
  h.codex.complete(h.current().threadId, h.current().turnId); for (let i = 0; i < 4; i++) await outbox.flush();
  assert.ok(texts.some(text => text.includes('Done'))); assert.equal(h.state.drainStatus().outbox, 0);
});

test('oversized exact actions retain structured manual preview instead of a truncated actionable card', async t => {
  const h = setup(); t.after(h.close); h.deliveries(); h.bridge.receive(message('Long action', { chatType: 'p2p' })); await until(() => h.turns().length === 1);
  const command = 'echo ' + 'bounded-content '.repeat(2000); h.codex.ask('large', 'item/commandExecution/requestApproval', { ...h.current(), command });
  const rows = []; for (;;) { const batch = h.state.pending(); if (!batch.length) break; rows.push(...batch); for (const row of batch) h.state.delivered(row.id); }
  assert.ok(rows.length > 1 && rows.every(row => !row.approval));
  const text = rows.map(row => row.body).join('\n').replace(/^`{3,}[^\n]*$/gm, '').replace(/\s/g, '');
  assert.ok(text.includes(command.replace(/\s/g, ''))); assert.equal(h.codex.replies.length, 0);
});

test('actual SDK event dispatch returns a bounded toast through Feishu without awaiting native work or using client command text', async t => {
  const id = randomUUID(); const raw = { schema: '2.0', header: { event_id: 'callback-1', app_id: 'cli_fixture', tenant_key: 'tenant', event_type: 'card.action.trigger' },
    host: 'im_message', context: { open_message_id: 'om_card', open_chat_id: 'chat' }, event: { operator: { open_id: 'ou_owner', tenant_key: 'tenant' },
      action: { tag: 'button', value: { kind: 'codex_approval', id, decision: 'reject', text: '/approve attacker' } } } };
  let click: ApprovalClick | undefined, dispatcher: lark.EventDispatcher | undefined;
  const f = new Feishu({ appId: 'cli_fixture', appSecret: 'fixture' }); t.after(() => f.close());
  const ws = Reflect.get(f, 'socket') as { start: (options: { eventDispatcher: lark.EventDispatcher }) => Promise<void>; onReady: () => void };
  t.mock.method(ws, 'start', async (options: { eventDispatcher: lark.EventDispatcher }) => { dispatcher = options.eventDispatcher; queueMicrotask(() => ws.onReady()); });
  await f.start(() => { throw Error('Callback must not become a chat task'); }, value => { click = value; return 'accepted'; });
  const response = await dispatcher!.invoke(raw, { needCheck: false });
  assert.ok(JSON.stringify(response).includes('toast')); assert.equal(click?.decision, 'reject'); assert.equal(click?.message, 'om_card'); assert.equal(click?.event, 'callback-1');
  assert.equal(normalizeApprovalClick({ ...raw.header, schema: '2.0', host: 'im_message', context: raw.context, ...raw.event, app_id: 'other' }, 'cli_fixture'), undefined);
  assert.equal(normalizeApprovalClick({ ...raw.header, schema: '2.0', host: 'im_message', context: raw.context, ...raw.event, operator: { open_id: 'ou_owner', tenant_key: 'other' } }, 'cli_fixture'), undefined);
});

test('Feishu sends interactive JSON and updates by message ID without creating replacements on uncertainty', async t => {
  const h = await pending(t); const f = new Feishu({ appId: 'cli_fixture', appSecret: 'fixture' }); t.after(() => f.close()); const calls: unknown[] = [];
  Object.assign(f, { client: { im: { v1: { message: { reply: async (x: unknown) => { calls.push(x); return { code: 0, data: { message_id: 'om_card' } }; },
    patch: async (x: unknown) => { calls.push(x); return { code: 0 }; }, create: async () => { throw Error('replacement forbidden'); } } } } } });
  await f.send('chat', h.delivery.body, h.delivery.id, { replyTo: 'om_origin', approval: h.p }); assert.equal(record(record(calls[0]).data).msg_type, 'interactive');
  const card = JSON.parse(String(record(record(calls[0]).data).content)); assert.equal(card.schema, '2.0');
  await f.updateApproval('om_card', h.p, 'expired'); assert.deepEqual(record(calls[1]).path, { message_id: 'om_card' });
  Object.assign(f, { client: { im: { v1: { message: { patch: async () => { throw Error('uncertain update'); } } } } } });
  await assert.rejects(f.updateApproval('om_card', h.p, 'approved'), /uncertain update/);
});

test('legacy sealed journals remain readable without migrating or modifying their bytes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'legacy-card-journal-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'bridge.db'); const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sessions(id TEXT,owner TEXT,directory TEXT,thread TEXT);
    CREATE TABLE tasks(id TEXT,session TEXT,trigger_message TEXT,turn TEXT);
    CREATE TABLE outbox(sequence INTEGER,id TEXT,chat TEXT,body TEXT,reply_to TEXT,mentions TEXT,final INTEGER,prompt_id TEXT,task TEXT);
    CREATE TABLE approvals(id TEXT,status TEXT,expires INTEGER);
    INSERT INTO sessions VALUES('s','owner','/fixture','thread'); INSERT INTO tasks VALUES('task','s','trigger','turn');
    INSERT INTO outbox VALUES(1,'delivery','chat','answer',NULL,NULL,1,NULL,NULL);
    INSERT INTO approvals VALUES('1234abcd','invalidated',100);`); db.close();
  const before = readFileSync(path); const projection = journalProjection(path);
  assert.equal(projection.messages[0]!.approval, null); assert.equal(projection.prompts[0]!.actor, null);
  assert.deepEqual(readFileSync(path), before);
});

test('a directory cannot make a malformed command into an actionable approval', async t => {
  const h = setup(); t.after(h.close); h.deliveries(); h.bridge.receive(message('Inspect task', { chatType: 'p2p' })); await until(() => h.turns().length === 1);
  h.codex.ask('malformed', 'item/commandExecution/requestApproval', { ...h.current(), cwd: h.config.projects.alpha, command: { invalid: true } });
  await until(() => h.codex.replies.length === 1);
  assert.deepEqual(h.codex.replies[0], { id: 'malformed', result: { decision: 'decline' } }); assert.ok(h.state.pending().every(d => !d.approval));
});
