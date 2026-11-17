import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import * as lark from '@larksuiteoapi/node-sdk';
import { Feishu, normalizeMessage } from '../src/feishu.js';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '../src/config.js';
import type { DeliveryOptions } from '../src/types.js';
import { nativePermissions, parseNativeReview, rememberProposal, deniedActionEvent, type NativePermissions } from '../src/permissions.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { archiveNativeEvidence } from '../src/handoff/migration.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { reviewCard, normalizeReviewClick, type ReviewPresentation, type ReviewClick } from '../src/review-card.js';
import { approvalCard, type ApprovalClick } from '../src/approval.js';
import { message, FakeCodex, until } from './helpers.js';

const policy: NativePermissions = { sandbox: 'workspace-write', reviewer: 'auto_review', rememberCommands: true };
const prefix = ['gh', 'pr', 'view'];
const proposal = { command: 'gh pr view 1 --repo example/project', reason: 'Read pull request', proposedExecpolicyAmendment: prefix,
  availableDecisions: ['accept', 'decline', { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } }] };
const rule = 'prefix_rule(pattern=["gh", "pr", "view"], decision="allow")\n';
const reviewEvent = (current: { threadId: string; turnId: string }, changes: Record<string, unknown> = {}) => ({ ...current, reviewId: randomUUID(), targetItemId: 'cmd', startedAtMs: 100, completedAtMs: 200,
  decisionSource: 'agent', review: { status: 'denied', riskLevel: 'low', userAuthorization: 'low', rationale: 'Read-only fixture requires explicit authorization' },
  action: { type: 'command', source: 'unifiedExec', command: 'printf NATIVE_RETRY_FIXTURE', cwd: '/tmp' }, ...changes });
class ManagedFake extends FakeCodex implements ManagedCodex {
  generation = randomUUID();
  async start() { this.ready = true; }
  async close() { this.exit(); }
}
function setup(t: TestContext, enabled = true, secrets: string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'permissions-'))), workspace = join(root, 'workspace'), home = join(root, 'codex');
  mkdirSync(workspace); mkdirSync(home);
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: workspace },
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { accessMode: 'allowlist', allowedUsers: ['ou_owner'], approvalUsers: ['ou_owner'], approvalChat: null,
    allowedTenant: 'tenant', enableGroups: false, groupContextMessages: 0, groupContextImages: 0, projects: scope.projects,
    projectRouting: 'workspace', codexExecutable: 'codex', stateDirectory: join(root, 'state'), approvalTimeoutSeconds: 300 };
  const admission = new PilotAdmission(config.stateDirectory, scope, 'workspace'), codexes: ManagedFake[] = [];
  const native = new NativeExecutions(admission, config, () => { const c = new ManagedFake(); codexes.push(c); return c; }, {},
    enabled ? { nativePermissions: policy, codexHome: home } : {});
  const sent: { id: string; body: string; options?: DeliveryOptions }[] = [], patches: { message: string; p: ReviewPresentation }[] = [];
  const reactions: string[] = [], sender = { send: async (_chat: string, body: string, id: string, options?: DeliveryOptions) => { sent.push({ id, body, options }); return 'om_' + id; },
    updateApproval: async () => {}, updateReview: async (message: string, p: ReviewPresentation) => { patches.push({ message, p }); } };
  let interactions = new PilotInteractions(admission, config, { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender,
    { addReaction: async m => { reactions.push(m); return 'reaction'; }, findReaction: async () => undefined, removeReaction: async () => {} }, secrets);
  const pending: Promise<unknown>[] = []; let run = 0;
  const admit = (text = 'Inspect fixture') => { const r = interactions.receive(message(text, { chatType: 'p2p' })); assert.ok('request' in r); return r.request; };
  const start = async (request = admit()) => {
    const index = codexes.length, grant = admission.store.reserve(request.id, ++run); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('No grant');
    const running = native.run(grant.permit); pending.push(running); await until(() => Boolean(codexes[index]?.calls.some(c => c.method === 'turn/start')));
    const c = codexes[index]!, call = c.calls.find(c => c.method === 'turn/start')!;
    const current = { threadId: String(call.params.threadId), turnId: 'turn-' + (c.calls.some(c => c.method === 'thread/start') ? 2 : 1) };
    return { request, running, c, current, complete: () => c.complete(current.threadId, current.turnId) };
  };
  const drain = async () => { for (let i = 0; i < 5; i++) await interactions.flush(); };
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config,
    { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender,
    { addReaction: async () => 'reaction', findReaction: async () => undefined, removeReaction: async () => {} }, secrets); };
  t.after(async () => { await native.stop(); await Promise.allSettled(pending); await interactions.close(); native.closePermissions(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, home, config, admission, native, codexes, sent, patches, reactions, admit, start, drain, restart, get interactions() { return interactions; } };
}
const click = (card: { id: string; options?: DeliveryOptions }, changes: Partial<ReviewClick> = {}): ReviewClick => ({ event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat',
  message: 'om_' + card.id, id: card.options!.reviewCard!.id, ...changes });

test('private native policy rejects invalid configuration and is absent unless explicitly enabled', async t => {
  assert.equal(nativePermissions(undefined), undefined); assert.deepEqual(nativePermissions(policy), policy);
  for (const v of [{ ...policy, sandbox: 'danger-full-access' }, { ...policy, reviewer: 'never' }, { ...policy, unexpected: true }, {}]) assert.throws(() => nativePermissions(v));
  const h = setup(t, false), task = await h.start();
  for (const c of task.c.calls.filter(c => ['thread/start', 'turn/start'].includes(c.method))) { assert.equal(c.params.approvalsReviewer, undefined); assert.equal(c.params.sandboxPolicy, undefined); }
  task.complete(); await task.running;
  h.interactions.receive(message('/rules', { chatType: 'p2p' })); await h.drain(); assert.equal(h.admission.store.requests().length, 1); assert.ok(h.sent.some(s => s.body.includes('尚未启用')));
});

test('policy applies on new and resumed native turns without changing model or effort', async t => {
  const h = setup(t), first = await h.start();
  for (const c of first.c.calls.filter(c => ['thread/start', 'turn/start'].includes(c.method))) {
    assert.equal(c.params.approvalsReviewer, 'auto_review'); assert.equal(c.params.approvalPolicy, 'on-request'); assert.equal(c.params.model, undefined); assert.equal(c.params.effort, undefined);
  }
  assert.equal(first.c.calls.find(c => c.method === 'thread/start')!.params.sandbox, 'workspace-write');
  assert.deepEqual(first.c.calls.find(c => c.method === 'turn/start')!.params.sandboxPolicy,
    { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
  first.complete(); await first.running; const second = await h.start();
  const resume = second.c.calls.find(c => c.method === 'thread/resume')!; assert.equal(resume.params.threadId, first.current.threadId); assert.equal(resume.params.approvalsReviewer, 'auto_review');
  second.complete(); await second.running;
});

test('remember is limited to the exact offered native read proposal and never broad shell or GraphQL authority', () => {
  assert.deepEqual(rememberProposal(proposal, s => s), prefix);
  for (const p of [{ ...proposal, availableDecisions: ['accept'] }, { ...proposal, kind: 'humanCommand' }, { ...proposal, kind: 'writeStdin' },
    { ...proposal, proposedExecpolicyAmendment: ['sh', '-c'] }, { ...proposal, proposedExecpolicyAmendment: ['gh', 'api', 'graphql'] },
    { ...proposal, networkApprovalContext: {} }, { ...proposal, proposedExecpolicyAmendment: ['gh', 'pr', 'view', 'SECRET"value'] }]) {
    assert.equal(rememberProposal(p, s => s.replace('SECRET"value', '[redacted]')), undefined);
  }
});

test('only owner clicking a confirmed current Remember card submits native persistence, with truthful file confirmation', async t => {
  const h = setup(t), task = await h.start(); task.c.ask('approval', 'item/commandExecution/requestApproval', { ...task.current, ...proposal, cwd: h.config.projects.pilot }); await h.drain();
  const d = h.sent.find(s => s.options?.approval)!, p = d.options!.approval!; assert.ok(p.remember);
  const cardText = JSON.stringify(approvalCard(p)); assert.ok(cardText.includes('不限定本任务或单个仓库')); assert.equal((cardText.match(/可记住的规则/g) ?? []).length, 1);
  assert.ok(p.action.includes(h.config.projects.pilot!));
  const action: ApprovalClick = { event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'om_' + d.id, id: p.id, decision: 'approve_save' };
  for (const changes of [{ user: 'ou_other' }, { chat: 'other' }, { message: 'om_unconfirmed' }]) assert.equal(h.interactions.cardAction({ ...action, ...changes }), 'rejected');
  assert.equal(h.interactions.cardAction(action), 'accepted'); await h.drain();
  assert.deepEqual(task.c.replies.at(-1), { id: 'approval', result: { decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } } } });
  assert.equal(h.native.permissions!.grant(p.remember!.id)!.status, 'submitted'); assert.equal(existsSync(join(h.home, 'rules/default.rules')), false);
  h.interactions.receive(message('/rules', { chatType: 'p2p' })); await h.drain(); assert.ok(h.sent.some(s => s.body.includes('尚无保存确认')));
  mkdirSync(join(h.home, 'rules')); writeFileSync(join(h.home, 'rules/default.rules'), rule);
  task.c.notify('serverRequest/resolved', { requestId: 'approval', threadId: task.current.threadId });
  assert.equal(h.native.permissions!.grant(p.remember!.id)!.status, 'present');
  task.complete(); await task.running; await h.drain(); assert.equal(task.c.replies.length, 1);
  writeFileSync(join(h.home, 'rules/default.rules'), ''); h.native.permissions!.observeSaves();
  assert.equal(h.native.permissions!.grant(p.remember!.id)!.status, 'present'); // historical observation stays historical
});

test('one-time approve, refusal and timeout never submit a remembered rule', async t => {
  for (const decision of ['approve', 'reject', 'timeout'] as const) {
    const h = setup(t); if (decision === 'timeout') h.config.approvalTimeoutSeconds = 0.01; const task = await h.start();
    task.c.ask('approval', 'item/commandExecution/requestApproval', { ...task.current, ...proposal }); await h.drain();
    const d = h.sent.find(s => s.options?.approval)!;
    if (decision !== 'timeout') { h.interactions.cardAction({ event: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', message: 'om_' + d.id, id: d.options!.approval!.id, decision }); await h.drain(); }
    else await until(() => task.c.replies.length > 0);
    assert.equal(h.native.permissions!.grants().filter(g => g.actor).length, 0); assert.equal(existsSync(join(h.home, 'rules/default.rules')), false);
    assert.deepEqual(task.c.replies.at(-1)!.result, { decision: decision === 'approve' ? 'accept' : 'decline' }); task.complete(); await task.running;
  }
});

test('owned revocation overlays preserve unrelated native appends and duplicate changes are lookup-only', async t => {
  const h = setup(t), ledger = h.native.permissions!, g = ledger.propose(randomUUID(), 'prompt', 'gen', prefix); ledger.submit(g.id, 'ou_owner');
  mkdirSync(join(h.home, 'rules')); const file = join(h.home, 'rules/default.rules'); writeFileSync(file, rule); ledger.observeSaves();
  if (spawnSync('codex', ['--version']).status === 0) assert.equal(await ledger.userRuleDecision(prefix), 'allow');
  assert.equal(await ledger.changeRule('revoke', 'ou_owner', g.id, true), 'applied');
  const extra = 'prefix_rule(pattern=["gh", "run", "view"], decision="allow")\n'; writeFileSync(file, rule + extra);
  if (spawnSync('codex', ['--version']).status === 0) assert.equal(await ledger.userRuleDecision(prefix), 'prompt'); assert.equal(readFileSync(file, 'utf8'), rule + extra);
  assert.equal(await ledger.changeRule('allow', 'ou_owner', g.id, false), 'applied'); if (spawnSync('codex', ['--version']).status === 0) assert.equal(await ledger.userRuleDecision(prefix), 'allow');
  assert.equal(await ledger.changeRule('revoke', 'ou_owner', g.id, true), 'applied'); assert.equal(ledger.revoked(prefix), false); // replay cannot reapply a prior change
  await assert.rejects(ledger.changeRule('foreign', 'ou_other', g.id, true));
  writeFileSync(ledger.revocationFile, '# manually modified\n'); assert.equal(await ledger.changeRule('manual', 'ou_owner', g.id, true), 'unknown');
  assert.equal(readFileSync(ledger.revocationFile, 'utf8'), '# manually modified\n');
});

test('native review parser distinguishes denial and uncertainty; only a concrete denial converts to native authorization', () => {
  const parsed = parseNativeReview(reviewEvent({ threadId: 'thread', turnId: 'turn' }))!; assert.equal(parsed.status, 'denied'); assert.equal(parsed.action!.source, 'unified_exec');
  assert.equal(deniedActionEvent(parsed).status, 'denied'); assert.equal(deniedActionEvent(parsed).action!.type, 'command');
  for (const status of ['approved', 'timedOut', 'aborted']) { const p = parseNativeReview(reviewEvent({ threadId: 't', turnId: 'u' }, { review: { status } }))!; assert.throws(() => deniedActionEvent(p)); }
  const unsupported = parseNativeReview(reviewEvent({ threadId: 't', turnId: 'u' }, { action: { type: 'mcpToolCall' } }))!; assert.equal(unsupported.action, null); assert.throws(() => deniedActionEvent(unsupported));
  assert.equal(parseNativeReview(reviewEvent({ threadId: 't', turnId: 'u' }, { completedAtMs: 1 })), undefined);
});

test('a sealed denied action requires a real confirmed owner card and admits exactly one fresh native-reviewed retry across restart', async t => {
  const h = setup(t), task = await h.start(), event = reviewEvent(task.current); task.c.notify('item/autoApprovalReview/completed', event);
  await h.drain(); assert.equal(h.sent.filter(s => s.options?.reviewCard).length, 0); task.complete(); await task.running; await h.drain();
  const d = h.sent.find(s => s.options?.reviewCard)!, card = d.options!.reviewCard!; assert.equal(card.retry, true); assert.ok(reviewCard(card));
  const file = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db'), before = readFileSync(file);
  const action = click(d); for (const fields of [{ user: 'ou_other' }, { message: 'om_wrong' }, { chat: 'other' }]) assert.equal(h.interactions.reviewAction({ ...action, ...fields }), 'rejected');
  const count = h.admission.store.requests().length; h.interactions.receive(message('/review ' + card.review, { chatType: 'p2p' })); await h.drain();
  assert.equal(h.admission.store.requests().length, count); assert.deepEqual(readFileSync(file), before);
  h.interactions.reviewAction(action); h.interactions.reviewAction(action); await h.drain(); assert.equal(h.admission.store.requests().length, 2);
  const retry = h.admission.store.requests().at(-1)!; assert.equal(retry.conversation, task.request.conversation); assert.equal(h.admission.store.permissionRetry(retry.execution)!.review.id, event.reviewId);
  assert.ok(h.patches.some(p => p.message === action.message && p.p.consumed && !p.p.retry));
  await h.restart(); h.interactions.reviewAction({ ...action, event: randomUUID() }); await h.drain(); assert.equal(h.admission.store.requests().length, 2);
  const next = await h.start(retry), methods = next.c.calls.map(c => c.method);
  assert.ok(methods.indexOf('thread/resume') < methods.indexOf('thread/approveGuardianDeniedAction')); assert.ok(methods.indexOf('thread/approveGuardianDeniedAction') < methods.indexOf('turn/start'));
  assert.deepEqual(next.c.calls.find(c => c.method === 'thread/approveGuardianDeniedAction')!.params.event, deniedActionEvent(parseNativeReview(event)!));
  assert.equal(next.c.calls.find(c => c.method === 'turn/start')!.params.approvalsReviewer, 'auto_review');
  next.complete(); await next.running; await h.drain(); assert.deepEqual(readFileSync(file), before); assert.ok(h.sent.some(s => s.body === 'Done' && s.options?.replyTo === action.message));
  assert.ok(h.reactions.every(m => !m.startsWith('permission-retry/'))); assert.equal(existsSync(join(h.home, 'rules/default.rules')), false);
});

test('new conversation work, timeout and unknown source cannot be turned into denial retry', async t => {
  for (const mode of ['newer', 'timedOut', 'unknown'] as const) {
    const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current,
      mode === 'timedOut' ? { review: { status: 'timedOut' } } : {}));
    if (mode === 'unknown') task.c.exit(); else task.complete(); await task.running; if (mode === 'newer') h.admit('Another task'); await h.drain();
    const fact = h.native.permissions!.reviews()[0]!, count = h.admission.store.requests().length;
    const d = h.sent.find(s => s.options?.reviewCard); if (d) assert.equal(d.options!.reviewCard!.retry, false);
    h.interactions.receive(message('/review-retry ' + fact.id, { chatType: 'p2p' })); await h.drain(); assert.equal(h.admission.store.requests().length, count);
    assert.ok(!h.codexes.some(c => c.calls.some(r => r.method === 'thread/approveGuardianDeniedAction')));
  }
});

test('retry admission rolls back request and intent together if persistence fails', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current)); task.complete(); await task.running; await h.drain();
  const d = h.sent.find(s => s.options?.reviewCard)!, db = new DatabaseSync(join(h.config.stateDirectory, 'handoff.db'));
  db.exec("CREATE TRIGGER fail_retry BEFORE INSERT ON permission_retries BEGIN SELECT RAISE(ABORT,'fixture storage unavailable'); END");
  h.interactions.reviewAction(click(d)); await h.drain(); assert.equal(h.admission.store.requests().length, 1);
  db.exec('DROP TRIGGER fail_retry'); db.close();
  h.interactions.reviewAction(click(d)); await h.drain(); assert.equal(h.admission.store.requests().length, 2);
});

test('review callbacks require the authenticated platform envelope, ignore client command fields and preserve uncertainty labels', () => {
  const raw = { schema: '2.0', app_id: 'fixture', event_id: 'evt_1', tenant_key: 'tenant', host: 'im_message', operator: { tenant_key: 'tenant', open_id: 'ou_owner' },
    context: { open_chat_id: 'chat', open_message_id: 'om_card' }, action: { tag: 'button', value: { kind: 'codex_review_retry', id: randomUUID(), text: '/approve attacker' } } };
  assert.ok(normalizeReviewClick(raw, 'fixture')); assert.equal(normalizeReviewClick(raw, 'other'), undefined); assert.equal(normalizeReviewClick({ ...raw, operator: { tenant_key: 'other', open_id: 'ou_owner' } }, 'fixture'), undefined);
});

test('official SDK review dispatch selects only the review handler and sends/patches the same interactive message', async t => {
  const f = new Feishu({ appId: 'fixture', appSecret: 'fixture' }); t.after(() => f.close());
  let dispatcher: lark.EventDispatcher | undefined, received: ReviewClick | undefined;
  const ws = Reflect.get(f, 'socket') as { start: (o: { eventDispatcher: lark.EventDispatcher }) => Promise<void>; onReady: () => void };
  t.mock.method(ws, 'start', async (o: { eventDispatcher: lark.EventDispatcher }) => { dispatcher = o.eventDispatcher; queueMicrotask(() => ws.onReady()); });
  await f.start(() => { throw Error('Not a chat task'); }, () => { throw Error('Not a command approval'); }, () => { throw Error('Not task refresh'); }, c => { received = c; return 'accepted'; });
  const id = randomUUID(), raw = { schema: '2.0', header: { event_id: 'evt_1', app_id: 'fixture', tenant_key: 'tenant', event_type: 'card.action.trigger' },
    host: 'im_message', context: { open_message_id: 'om_review', open_chat_id: 'chat' }, event: { operator: { open_id: 'ou_owner', tenant_key: 'tenant' },
      action: { tag: 'button', value: { kind: 'codex_review_retry', id } } } };
  const response = await dispatcher!.invoke(raw, { needCheck: false }); assert.ok(JSON.stringify(response).includes('toast')); assert.equal(received?.id, id); assert.equal(received?.message, 'om_review');
  const p: ReviewPresentation = { id, review: randomUUID(), tenant: 'tenant', user: 'ou_owner', chat: 'chat', text: 'Denied fixture', retry: true, expires: Date.now() + 60_000 };
  const calls: Record<string, unknown>[] = [];
  Object.assign(f, { client: { im: { v1: { message: { reply: async (v: Record<string, unknown>) => { calls.push(v); return { code: 0, data: { message_id: 'om_review' } }; },
    patch: async (v: Record<string, unknown>) => { calls.push(v); return { code: 0 }; }, create: async () => { throw Error('No replacement'); } } } } } });
  await f.send('chat', p.text, randomUUID(), { replyTo: 'om_original', reviewCard: p });
  assert.equal((calls[0]!.data as { msg_type: string }).msg_type, 'interactive');
  await f.updateReview('om_review', { ...p, retry: false, consumed: true }); assert.deepEqual(calls[1]!.path, { message_id: 'om_review' });
  assert.ok(!JSON.parse((calls[1]!.data as { content: string }).content).body.elements.some((e: { tag: string }) => e.tag === 'button'));
});


test('copied pure permission query posts remain read-only; rule writes and retry posts are rejected', () => {
  const post = (text: string) => normalizeMessage({ tenant_key: 'tenant', sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
    message: { chat_type: 'p2p', chat_id: 'chat', message_id: 'om_post', message_type: 'post', content: JSON.stringify({ content: [[{ tag: 'text', text }]] }) } });
  for (const text of ['/rules', '/reviews', '/review ' + randomUUID()]) { const p = post(text)!; assert.equal(p.text, text); assert.equal(p.unsupported, undefined); }
  for (const text of ['/rules revoke ' + randomUUID(), '/rules allow ' + randomUUID(), '/review-retry ' + randomUUID()]) assert.equal(post(text)!.unsupported, 'post');
});


test('changed sealed denial bytes cannot reach a native retry executor', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current)); task.complete(); await task.running; await h.drain();
  const card = h.sent.find(s => s.options?.reviewCard)!; h.interactions.reviewAction(click(card)); await h.drain();
  const retry = h.admission.store.requests().at(-1)!, path = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db'), before = readFileSync(path);
  writeFileSync(path, Buffer.concat([before, Buffer.from('changed sealed bytes')]));
  const permit = h.admission.store.reserve(retry.id, 99); assert.equal(permit.kind, 'start'); if (permit.kind !== 'start') throw Error('No permit');
  await assert.rejects(h.native.run(permit.permit)); assert.equal(h.codexes.length, 1); assert.equal(h.admission.store.unsettled().length, 1);
  writeFileSync(path, before);
});

test('permission audit is archived separately from external native rules', t => {
  const h = setup(t), grant = h.native.permissions!.propose('source', 'prompt', 'generation', prefix), archive = join(h.root, 'archive'); mkdirSync(archive);
  const files = archiveNativeEvidence(h.config.stateDirectory, archive); assert.ok(files['permissions/bridge.db']);
  const db = new DatabaseSync(join(archive, 'permissions/bridge.db'), { readOnly: true });
  assert.equal(JSON.parse((db.prepare('SELECT body FROM grants').get() as { body: string }).body).id, grant.id); db.close();
  assert.equal(existsSync(join(archive, 'default.rules')), false);
});

test('redacted actions and expired review cards cannot authorize a retry', async t => {
  const secret = 'SECRET_with*quote"', h = setup(t, true, [secret]), task = await h.start();
  task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current, { review: { status: 'denied', rationale: secret },
    action: { type: 'command', source: 'unifiedExec', command: 'printf ' + secret, cwd: '/tmp' } })); task.complete(); await task.running; await h.drain();
  const card = h.sent.find(s => s.options?.reviewCard)!; assert.equal(card.options!.reviewCard!.retry, false); assert.ok(!JSON.stringify(card).includes('SECRET'));
  const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  const payload = { ...card.options!.reviewCard!, expires: Date.now() - 1, retry: true };
  db.prepare('UPDATE review_cards SET payload=? WHERE id=?').run(JSON.stringify(payload), payload.id); db.close();
  assert.equal(h.interactions.reviewAction(click(card)), 'rejected'); assert.equal(h.admission.store.requests().length, 1);
});

test('relative denied commands disclose their exact directory in the owner view and fresh retry input', async t => {
  for (const name of ['project-a', 'project-b']) {
    const h = setup(t), task = await h.start(), cwd = join(h.root, name); mkdirSync(cwd);
    const event = reviewEvent(task.current, { action: { type: 'command', source: 'unifiedExec', command: 'ls ./output', cwd } });
    task.c.notify('item/autoApprovalReview/completed', event); task.complete(); await task.running; await h.drain();
    const card = h.sent.find(s => s.options?.reviewCard)!; assert.ok(card.body.includes(cwd)); assert.ok(card.body.includes('ls ./output'));
    h.interactions.reviewAction(click(card)); await h.drain(); const retry = h.admission.store.requests().at(-1)!;
    assert.ok(retry.input.includes(cwd)); assert.ok(retry.input.includes('ls ./output'));
    const next = await h.start(retry), auth = next.c.calls.find(c => c.method === 'thread/approveGuardianDeniedAction')!;
    assert.equal(((auth.params.event as { action: { cwd: string } }).action).cwd, cwd); next.complete(); await next.running;
  }
});

test('oversized and multibyte native reviews deliver complete text once without authorizing a retry', async t => {
  for (const [command, rationale] of [['printf ' + 'long-command-'.repeat(1500), 'ASCII oversized action'], ['只读'.repeat(3500), '说明'.repeat(2000)]]) {
    const h = setup(t), task = await h.start();
    task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current, { action: { type: 'command', source: 'unifiedExec', command, cwd: '/tmp/known-directory' }, review: { status: 'denied', rationale } }));
    task.complete(); await task.running; const path = join(h.config.stateDirectory, 'executions', task.request.execution, 'bridge.db'), before = readFileSync(path);
    for (let i = 0; i < 25; i++) await h.interactions.flush();
    const fact = h.native.permissions!.reviews()[0]!, published = h.sent.map(s => s.body).join('\n').replace(/^`{3,}[^\n]*$/gm, '').replace(/\s/g, '');
    assert.equal(h.sent.filter(s => s.options?.reviewCard).length, 0); assert.ok(published.includes(command!.replace(/\s/g, ''))); assert.ok(published.includes(rationale!.replace(/\s/g, '')));
    assert.ok(published.includes('/tmp/known-directory')); assert.ok(h.native.permissions!.review(fact.id)!.published); assert.equal(h.admission.store.requests().length, 1);
    const count = h.sent.length; await h.drain(); assert.equal(h.sent.length, count);
    const query = message('/review ' + fact.id, { chatType: 'p2p' }); h.interactions.receive(query); h.interactions.receive(query);
    for (let i = 0; i < 25; i++) await h.interactions.flush();
    const replies = h.sent.filter(s => s.options?.replyTo === query.id); assert.ok(replies.length > 0 && replies.every(s => !s.options?.reviewCard));
    assert.ok(replies.map(s => s.body).join('\n').includes('不提供该记录的授权重试'));
    h.interactions.receive(message('/review-retry ' + fact.id, { chatType: 'p2p' })); await h.drain();
    assert.equal(h.admission.store.requests().length, 1); assert.deepEqual(readFileSync(path), before); assert.equal(h.codexes.length, 1);
  }
});

test('later approved reviews cannot hide an unpublished denial or remove it from nonapproved history', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current));
  const denied = h.native.permissions!.reviews()[0]!;
  for (let i = 0; i < 105; i++) task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current, { review: { status: 'approved', rationale: 'Later approved action' } }));
  task.complete(); await task.running; await h.drain();
  assert.equal(h.sent.filter(s => s.options?.reviewCard?.review === denied.id).length, 1); assert.ok(h.native.permissions!.review(denied.id)!.published);
  assert.equal(h.native.permissions!.reviews('unpublished').length, 0);
  h.interactions.receive(message('/reviews', { chatType: 'p2p' })); await h.drain(); assert.ok(h.sent.some(s => s.body.includes('/review ' + denied.id)));
});

test('a consumed card cannot revive its authorization after a maintenance-rejected click', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current)); task.complete(); await task.running; await h.drain();
  const card = h.sent.find(s => s.options?.reviewCard)!, action = click(card);
  h.admission.store.maintenance.quiesce(); h.interactions.reviewAction(action); await h.drain(); assert.equal(h.admission.store.requests().length, 1);
  h.admission.store.maintenance.resume(); assert.equal(h.interactions.reviewAction({ ...action, event: randomUUID() }), 'rejected'); await h.drain(); assert.equal(h.admission.store.requests().length, 1);
  const fact = h.native.permissions!.reviews('nonapproved')[0]!;
  h.interactions.receive(message('/review ' + fact.id, { chatType: 'p2p' })); await h.drain();
  const fresh = h.sent.filter(s => s.options?.reviewCard).at(-1)!; assert.notEqual(fresh.id, card.id); assert.equal(fresh.options!.reviewCard!.retry, true);
  h.interactions.reviewAction(click(fresh)); await h.drain(); assert.equal(h.admission.store.requests().length, 2);
});

test('two queued clicks cannot revive a card consumed while maintenance was paused', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current)); task.complete(); await task.running; await h.drain();
  const card = h.sent.find(s => s.options?.reviewCard)!, state = h.interactions.transport.state, finish = state.finishReviewCard.bind(state);
  let consumed = false;
  t.mock.method(state, 'finishReviewCard', (id: string, text: string) => { finish(id, text); if (!consumed) { consumed = true; h.admission.store.maintenance.resume(); } });
  h.admission.store.maintenance.quiesce();
  assert.equal(h.interactions.reviewAction(click(card)), 'accepted'); assert.equal(h.interactions.reviewAction(click(card)), 'accepted');
  await h.drain(); assert.ok(consumed); assert.equal(h.admission.store.maintenance.paused, false); assert.equal(h.admission.store.requests().length, 1);
});

test('a card expiring during asynchronous evidence inspection cannot authorize admission', async t => {
  const h = setup(t), task = await h.start(); task.c.notify('item/autoApprovalReview/completed', reviewEvent(task.current)); task.complete(); await task.running; await h.drain();
  const card = h.sent.find(s => s.options?.reviewCard)!, projection = h.native.projection.bind(h.native);
  let release!: () => void, entered = false; const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(h.native, 'projection', async (execution: string) => { entered = true; await gate; return projection(execution); });
  h.interactions.reviewAction(click(card)); await until(() => entered);
  const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  db.prepare('UPDATE review_cards SET payload=? WHERE id=?').run(JSON.stringify({ ...card.options!.reviewCard!, expires: Date.now() - 1 }), card.options!.reviewCard!.id); db.close();
  release(); await h.drain(); assert.equal(h.admission.store.requests().length, 1); assert.equal(h.codexes.length, 1);
});

test('unaccepted proposals cannot hide an owned rule from inspection or save reconciliation', async t => {
  const h = setup(t), ledger = h.native.permissions!, grant = ledger.propose('saved', 'prompt', 'generation', prefix); ledger.submit(grant.id, 'ou_owner');
  for (let i = 0; i < 105; i++) ledger.propose('unaccepted-' + i, 'prompt', 'generation', prefix);
  mkdirSync(join(h.home, 'rules')); writeFileSync(ledger.defaultFile, rule); ledger.observeSaves('saved'); assert.equal(ledger.grant(grant.id)!.status, 'present');
  h.interactions.receive(message('/rules', { chatType: 'p2p' })); await h.drain();
  assert.ok(h.sent.some(s => s.body.includes(grant.id) && s.body.includes('默认文件中存在'))); assert.equal(h.admission.store.requests().length, 0);
});
