import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync, unlinkSync, type ReadStream } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Config } from '../src/config.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { ownerKey, type DeliveryOptions, type ContextPort } from '../src/types.js';
import { SteerTargetEnded } from '../src/codex/client.js';
import { FakeCodex, until } from './helpers.js';
import { readJournal } from '../src/handoff/journal.js';
import { Feishu } from '../src/feishu.js';
import { Outbox } from '../src/outbox.js';
import { queueVisualReceipt } from '../src/handoff/visual-receipt.js';
import { fingerprint } from '../src/handoff/verification-profile.js';
import { acquireRoot, fenceFile, manageRuntime, openRuntimeControl, writePrivate } from '../src/handoff/ownership.js';
import { matterCard, normalizeMatterClick } from '../src/matter-card.js';
import type { ApprovalClick, ApprovalView, ApprovalPresentation } from '../src/approval.js';

import { ManagedRefundObserver, projectRefundNotices } from '../src/handoff/refund-monitor.js';
import { RefundObserver } from '../src/sls-refund/observer.js';
import { parseObserverConfig, readEvaluations, readEvidence } from '../src/sls-refund/sls-source.js';
import { pollRefundObserver } from '../src/sls-refund/poll.js';

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
  let admission = new PilotAdmission(config.stateDirectory, scope);
  const codex = new ManagedFake();
  let native = new NativeExecutions(admission, config, () => codex);
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
  let add = async (message: string) => { const id = 'reaction-' + message; reactions.set(message, id); return id; };
  const port = { addReaction: (message: string) => add(message),
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
  const restart = async (reopenAdmission = false) => {
    await interactions.close();
    if (reopenAdmission) {
      admission.close();
      admission = new PilotAdmission(config.stateDirectory, scope);
      native = new NativeExecutions(admission, config, () => codex);
    }
    interactions = new PilotInteractions(admission, config, { flush: publish, diagnose: async () => ({ status: 'unavailable' }) }, native, sender, port, ['fixture-private-secret'], context);
    await interactions.recover();
    return interactions;
  };
  t.after(async () => { await native.stop(); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { config, get admission() { return admission; }, get native() { return native; }, codex, sent, cardUpdates, reactions, actor, launch, restart, get interactions() { return interactions; },
    setSend: (value: typeof send) => { send = value; }, setAdd: (value: typeof add) => { add = value; },
    setRemove: (value: typeof remove) => { remove = value; } };
}

async function drain(h: ReturnType<typeof setup>) { for (let i = 0; i < 12; i++) await h.interactions.flush(); }

test('owner visual evidence is paired by scenario, sent once after retry and binds the quote to its task', async t => {
  const h = setup(t);
  const active = await h.launch();
  const execution = active.request.execution;
  const state = h.interactions.transport.state;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-candidate-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(root, '.gitignore'), '.ui-eval/\n');
  git('add', '.gitignore');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  const repository = 'https://example.test/ui.git';
  git('remote', 'add', 'origin', repository);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9sAAAAASUVORK5CYII=', 'base64');
  const make = (checkpoint: string, label: string, dirtyTree = false, status = 'passed') => {
    const run = randomUUID();
    const dir = join(root, '.ui-eval/wechat-runs', run);
    mkdirSync(dir, { recursive: true });
    const imagePath = join(dir, checkpoint + '.png');
    writeFileSync(imagePath, png);
    const json = JSON.stringify({ apiVersion: 'uieval.io/wechat-pilot-v1', kind: 'WechatPilotResult',
      executionId: run, projectId: 'fixture', sourceCommit: commit, scenarioId: checkpoint, status, cleanup: 'completed',
      sourceDigest: 'sha256:' + fingerprint(JSON.stringify({ commitSha: commit, dirtyTree, repository })),
      runtimeDigest: 'sha256:' + 'b'.repeat(64), assertions: { passed: 4, failed: 0 },
      screenshots: [{ checkpointId: checkpoint, path: checkpoint + '.png', digest: 'sha256:' + fingerprint(png), widthPx: 1, heightPx: 1 }] });
    writeFileSync(join(dir, 'report.json'), json);
    return { imagePath, entry: { run, checkpoint, label, reportSha256: fingerprint(json) } };
  };
  const home = make('home', '游客首页');
  const profile = make('profile', '个人中心');
  const plan = join(root, '.ui-eval/receipt.json');
  const planFor = (scenes: (typeof home.entry)[]) => writeFileSync(plan, JSON.stringify({
    projectRoot: root, projectId: 'fixture', commit, reviewFocus: '检查选中态', scenes,
  }), { mode: 0o600 });
  planFor([home.entry, profile.entry]);
  const queue = () => queueVisualReceipt(h.admission, state, execution, plan, () => {});
  await assert.rejects(queue, /completed owner-private/);
  h.codex.complete(active.thread, active.turn);
  await active.running;
  await drain(h);
  await assert.rejects(queueVisualReceipt(h.admission, state, execution, plan, () => {
    h.admission.store.maintenance.quiesce();
  }), /paused/);
  h.admission.store.maintenance.resume();
  planFor([make('dirty', '临时改动', true).entry]);
  await assert.rejects(queue, /Invalid or foreign visual receipt report/);
  planFor([make('changed', '候选曾变化', false, 'inconclusive').entry]);
  await assert.rejects(queue, /Invalid or foreign visual receipt report/);
  planFor([home.entry, profile.entry]);
  git('remote', 'set-url', 'origin', 'https://example.test/foreign.git');
  await assert.rejects(queue, /Invalid or foreign visual receipt report/);
  git('remote', 'set-url', 'origin', repository);
  writeFileSync(home.imagePath, Buffer.concat([png, Buffer.from('changed')]));
  await assert.rejects(queue, /differs from its report/);
  writeFileSync(home.imagePath, png);
  const receipt = await queue();
  assert.deepEqual(await queue(), receipt);

  const sdk = new Feishu({ appId: 'fixture', appSecret: 'fixture' });
  t.after(() => sdk.close());
  const uploads: Buffer[] = [];
  const ordinary: string[] = [];
  let recalled = false;
  let standalone = false;
  const replies: { path: { message_id: string }; data: { msg_type: string; content: string; uuid: string } }[] = [];
  Object.assign(sdk, { client: { im: { v1: {
    image: { create: async ({ data }: { data: { image_type: string; image: ReadStream } }) => {
      assert.equal(data.image_type, 'message');
      assert.equal(basename(String(data.image.path)), 'screenshot.png');
      const chunks = [];
      for await (const chunk of data.image) chunks.push(Buffer.from(chunk));
      uploads.push(Buffer.concat(chunks));
      return { image_key: 'img_fixture_' + uploads.length };
    } },
    message: { create: async () => { standalone = true; return { code: 0 }; }, reply: async (value: typeof replies[number]) => {
      if (recalled) return { code: 230011 };
      if (value.data.uuid !== receipt.delivery) {
        ordinary.push(value.path.message_id);
        return { code: 0, data: { message_id: 'ordinary-reply' } };
      }
      replies.push(value);
      if (replies.length === 1) throw Error('fixture send outcome unavailable');
      return { code: 0, data: { message_id: 'visual-receipt' } };
    } },
  } } } });
  const quote = h.actor('继续检查图标。', { parentId: 'visual-receipt' });
  await new Outbox(state, sdk).flush();
  assert.equal(state.confirmedAnswer(quote), undefined);
  state.send(quote.chat, '常规回复', { replyTo: 'ordinary-trigger' });
  await new Outbox(state, sdk).flush();
  assert.deepEqual(ordinary, ['ordinary-trigger']);
  const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  try { db.prepare('UPDATE outbox SET next=0 WHERE id=?').run(receipt.delivery); }
  finally { db.close(); }
  await new Outbox(state, sdk).flush();
  assert.deepEqual(uploads, [png, png]);
  assert.deepEqual(replies[0], replies[1]);
  assert.equal(replies[1]?.path.message_id, active.message.id);
  assert.equal(replies[1]?.data.uuid, receipt.delivery);
  assert.equal(replies[1]?.data.msg_type, 'post');
  const rendered = JSON.parse(replies[1]!.data.content).zh_cn;
  assert.match(rendered.title, /2\/2 个场景通过/);
  assert.deepEqual(rendered.content.slice(-4), [
    [{ tag: 'text', text: '游客首页 · 通过 · 已执行断言 4/4', style: ['bold'] }],
    [{ tag: 'img', image_key: 'img_fixture_1' }],
    [{ tag: 'text', text: '个人中心 · 通过 · 已执行断言 4/4', style: ['bold'] }],
    [{ tag: 'img', image_key: 'img_fixture_2' }],
  ]);
  assert.equal(state.confirmedAnswer(quote), execution);
  assert.equal(state.confirmedAnswer({ ...quote, user: 'someone-else' }), undefined);
  assert.deepEqual(await queue(), receipt);
  assert.equal(state.pending().length, 0);
  planFor([home.entry]);
  const orphaned = await queue();
  recalled = true;
  await new Outbox(state, sdk).flush();
  assert.equal(standalone, false);
  assert.deepEqual(await queue(), { ...orphaned, status: 'target-unavailable' });
  assert.equal(state.pending().length, 0);
});

test('managed visual submission can acknowledge validation slower than native controls', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'visual-control-')));
  writePrivate(join(root, fenceFile), { version: 1, role: 'pilot', root, data: root, operation: 'fixture' });
  const lease = await acquireRoot(root, 'pilot', root);
  const controller = await openRuntimeControl(lease, async request => {
    if (request.reference !== 'approved-plan') throw Error('Fixture rejection');
    await new Promise(resolve => setTimeout(resolve, 1600));
    return { delivery: 'fixture-receipt' };
  });
  t.after(async () => { await controller.close(true); await lease.release(); rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(manageRuntime(root, 'visual-receipt', 'task', 'wrong-plan'), /rejected by the gateway/);
  assert.deepEqual(await manageRuntime(root, 'visual-receipt', 'task', 'approved-plan'), { delivery: 'fixture-receipt' });
});

for (const [name, reference] of [
  ['iOS candidate', 'ios:release-41@sha256:' + 'a'.repeat(64)],
  ['Web preview', 'https://preview.example.test/build/17?commit=' + 'b'.repeat(40)],
] as const) test('owner confirms the exact ' + name + ' checkpoint after reopening admission and resumes once', async t => {
  const h = setup(t);
  h.config.approvalUsers = ['ou_owner'];
  h.config.approvalChat = 'chat';
  const first = await h.launch();
  const wait = h.actor('/delivery-wait ' + first.request.execution + ' ' + reference);
  h.interactions.receive(wait);
  assert.equal(h.admission.store.deliveryCheckpoint(wait, first.request.project, first.request.execution), undefined);
  h.codex.complete(first.thread, first.turn);
  await first.running;

  const registered = h.actor(wait.text);
  h.interactions.receive(registered);
  const saved = h.admission.store.deliveryCheckpoint(registered, first.request.project, first.request.execution);
  assert.ok(saved);
  assert.deepEqual({ ...saved }, { execution: first.request.execution, reference, resumed: null });
  await h.restart(true);
  const before = h.admission.store.requests().length;
  const query = h.actor('/delivery ' + first.request.execution);
  h.interactions.receive(query);
  await drain(h);
  const view = h.sent.find(row => row.options?.replyTo === query.id);
  assert.ok(view);
  assert.ok(view.text.includes('等待确认这份证据'));
  assert.ok(view.text.includes(reference));
  const confirmationHeader = '/delivery-confirm ' + first.request.execution + ' ' + reference;
  const copyable = view.text.split('\n').find(line => line.startsWith('/delivery-confirm '));
  assert.equal(copyable, confirmationHeader);
  assert.doesNotMatch(view.text, /\n后续任务内容/);
  const waitReplacement = h.actor(wait.text + '-other');
  h.interactions.receive(waitReplacement);
  const followup = '  candidate: inspect\n    requested: Check the recorded candidate only';
  const confirm = (candidate = reference) => '/delivery-confirm ' + first.request.execution + ' ' + candidate + '\n' + followup;
  for (const malformed of [confirm(reference + '-other'), copyable!]) {
    h.interactions.receive(h.actor(malformed));
  }
  for (const overrides of [{ user: 'ou_admin' }, { chat: 'admin' }, { tenant: 'foreign' }, { chatType: 'group' }]) {
    assert.equal(h.interactions.receive(h.actor(confirm(), overrides)).status, 'ignored');
  }
  assert.equal(h.admission.store.requests().length, before);
  const action = h.actor(confirm());
  assert.equal(h.interactions.receive(action).status, 'task-reply');
  assert.equal(h.interactions.receive(action).status, 'ignored');
  h.interactions.receive(h.actor(confirm()));
  assert.equal(h.admission.store.requests().length, before + 1);
  await h.restart(true);
  await drain(h);
  const checkpoint = h.admission.store.deliveryCheckpoint(action, first.request.project, first.request.execution);
  assert.ok(checkpoint?.resumed);
  const continuation = h.admission.store.request(checkpoint.resumed)!;
  assert.equal(continuation.conversation, first.request.conversation);
  assert.equal(h.admission.store.conversationThread(continuation.conversation), first.thread);
  assert.ok(continuation.input.includes(reference));
  assert.ok(continuation.input.includes('\n' + followup + '\n\n'));
  const receipt = h.sent.filter(row => row.options?.replyTo === action.id && row.text.includes('已记录证据确认'));
  assert.equal(receipt.length, 1);
  const grant = h.admission.store.reserve(continuation.id, 2);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected continuation reservation');
  h.codex.calls.length = 0;
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  assert.equal(h.codex.calls.find(call => call.method === 'thread/resume')?.params.threadId, first.thread);
  const turns = h.codex.calls.filter(call => call.method === 'turn/start');
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.params.threadId, first.thread);
  assert.ok(JSON.stringify(turns[0]!.params.input).includes(reference));
  h.codex.complete(first.thread, 'turn-3');
  await running;
});

test('delivery confirmation waits for verifiable original journal evidence', async t => {
  const h = setup(t);
  h.config.approvalUsers = ['ou_owner'];
  h.config.approvalChat = 'chat';
  const first = await h.launch();
  h.codex.complete(first.thread, first.turn);
  await first.running;
  const reference = 'ios:release-42@sha256:example';
  const register = h.actor('/delivery-wait ' + first.request.execution + ' ' + reference);
  const journal = join(h.config.stateDirectory, 'executions', first.request.execution, 'bridge.db');
  const original = readFileSync(journal);
  unlinkSync(journal);
  h.interactions.receive(register);
  assert.equal(h.admission.store.deliveryCheckpoint(register, first.request.project, first.request.execution), undefined);
  writeFileSync(journal, original, { mode: 0o600 });
  h.interactions.receive(h.actor(register.text));
  unlinkSync(journal);
  const confirm = '/delivery-confirm ' + first.request.execution + ' ' + reference + '\nInspect the candidate';
  const attempt = h.actor(confirm);
  h.interactions.receive(attempt);
  assert.equal(h.admission.store.requests().length, 1);
  assert.equal(h.admission.store.deliveryCheckpoint(attempt, first.request.project, first.request.execution)?.resumed, null);
  writeFileSync(journal, original, { mode: 0o600 });
  assert.equal(h.interactions.receive(h.actor(confirm)).status, 'task-reply');
  assert.equal(h.admission.store.requests().length, 2);
});

test('delivery confirmation preserves the checkpoint when the original conversation no longer points at its thread', async t => {
  const h = setup(t);
  h.config.approvalUsers = ['ou_owner'];
  h.config.approvalChat = 'chat';
  const first = await h.launch();
  h.codex.complete(first.thread, first.turn);
  await first.running;
  const reference = 'web:preview@version-42';
  const wait = h.actor('/delivery-wait ' + first.request.execution + ' ' + reference);
  h.interactions.receive(wait);
  const db = new DatabaseSync(join(h.config.stateDirectory, 'handoff.db'));
  db.prepare('UPDATE conversations SET thread=? WHERE id=?').run('replacement-thread', first.request.conversation);
  db.close();
  const input = h.actor('/delivery-confirm ' + first.request.execution + ' ' + reference + '\nInspect the preview');
  h.interactions.receive(input);
  assert.equal(h.admission.store.requests().length, 1);
  assert.equal(h.admission.store.deliveryCheckpoint(input, first.request.project, first.request.execution)?.resumed, null);
  await drain(h);
  assert.ok(h.sent.some(row => row.options?.replyTo === input.id && row.text.includes('交付未续接')));
});

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

async function completeRequest(h: ReturnType<typeof setup>, id: string, run: number) {
  const issued = h.admission.store.reserve(id, run);
  assert.equal(issued.kind, 'start');
  if (issued.kind !== 'start') throw Error('Expected assignment');
  const count = h.codex.calls.filter(call => call.method === 'turn/start').length;
  const running = h.native.run(issued.permit);
  const turns = () => h.codex.calls.filter(call => call.method === 'turn/start');
  await until(() => turns().length > count);
  const params = turns().at(-1)!.params;
  const thread = String(params.threadId);
  const sequence = h.codex.calls.filter(call => ['thread/start', 'turn/start'].includes(call.method)).length;
  h.codex.complete(thread, 'turn-' + sequence);
  await running;
  return params;
}

test('switching matters starts separate native threads and quoting the older task resumes its original thread', async t => {
  const h = setup(t);

  const newRefund = h.actor('/matter-new 退款调查');
  h.interactions.receive(newRefund);
  await drain(h);
  const card = h.sent.find(item => item.options?.replyTo === newRefund.id)!;
  const matter = card.options!.matterCard!;
  assert.equal(matter.title, '退款调查');
  const initial = h.actor('只查询当前退款积压');
  const a = h.interactions.receive(initial);
  assert.ok('request' in a);
  const threadA = (await completeRequest(h, a.request.id, 101)).threadId;
  await drain(h);
  const answerA = h.sent.find(row => row.options?.replyTo === initial.id && row.text === 'Done')!;
  assert.ok(answerA);
  assert.equal(h.sent.filter(row => row.options?.replyTo === initial.id && row.text === '已收到 · 退款调查').length, 1);

  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const b = h.interactions.receive(h.actor('检查待发布版本'));
  assert.ok('request' in b);
  assert.notEqual(a.request.conversation, b.request.conversation);
  assert.equal(a.request.project, b.request.project);
  const threadB = (await completeRequest(h, b.request.id, 102)).threadId;
  assert.notEqual(threadA, threadB);

  await h.restart();
  const quote = h.actor('再看微信渠道', { parentId: initial.id });
  assert.equal(h.interactions.receive(quote).status, 'task-reply');
  const followup = h.admission.store.requestForMessage(quote)!;
  assert.equal(followup.conversation, a.request.conversation);
  assert.equal((await completeRequest(h, followup.id, 103)).threadId, threadA);
  const answerQuote = h.actor('刚才那个方案呢？', { parentId: 'delivered-' + answerA.id });
  for (const actor of [{ ...answerQuote, user: 'ou_admin' }, { ...answerQuote, chat: 'other' }, { ...answerQuote, tenant: 'other' }]) {
    assert.equal(h.interactions.receive(actor).status, 'ignored');
    assert.equal(h.interactions.transport.state.confirmedAnswer(actor), undefined);
  }
  assert.equal(h.interactions.receive(answerQuote).status, 'task-reply');
  const answerFollowup = h.admission.store.requestForMessage(answerQuote)!;
  assert.equal(answerFollowup.conversation, a.request.conversation);
  assert.equal((await completeRequest(h, answerFollowup.id, 104)).threadId, threadA);
  assert.equal(h.interactions.receive(answerQuote).status, 'ignored');
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === answerQuote.id && row.text.includes('事项 · 退款调查')).length, 1);
  const receipt = h.sent.find(row => row.options?.replyTo === initial.id && row.text === '已收到 · 退款调查')!;
  assert.equal(h.interactions.transport.state.confirmedAnswer(h.actor('再看看', { parentId: 'delivered-' + receipt.id })), undefined);
  const plain = h.actor('继续刚才的处理');
  assert.equal(h.interactions.receive(plain).status, 'matter-choice');
  assert.deepEqual(h.admission.store.matters.held(plain, h.admission.project)?.choices, [b.request.conversation, a.request.conversation]);
  assert.equal(h.admission.store.requestForMessage(plain), undefined);
  assert.equal(h.admission.store.matters.focus({ owner: ownerKey(plain), project: h.admission.project }), b.request.conversation);
  const cardReply = h.interactions.receive(h.actor('只查询最近的发布记录', { parentId: 'delivered-' + card.id }));
  assert.ok('request' in cardReply);
  assert.equal(cardReply.request.conversation, a.request.conversation);
  const explicit = h.interactions.receive(h.actor('Solura 发版：检查发布清单'));
  assert.ok('request' in explicit);
  const next = h.interactions.receive(h.actor('接着'));
  assert.ok('request' in next);
  assert.equal(next.request.conversation, b.request.conversation);
  assert.equal(h.codex.calls.filter(call => call.method === 'thread/start').length, 2);
});

test('the first vague follow-up after a switch waits for the prior or current matter', async t => {
  const h = setup(t);
  const original = h.interactions.receive(h.actor('先检查退款方案'));
  assert.ok('request' in original);
  h.interactions.receive(h.actor('/matter-new 退款调查'));
  const backToDefault = h.actor('刚才那个？');
  assert.equal(h.interactions.receive(backToDefault).status, 'matter-choice');
  const a = h.interactions.receive(h.actor('退款调查：收集微信渠道错误'));
  assert.ok('request' in a, 'an explicit title bypasses the ambiguous follow-up guard');
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const scope = { owner: ownerKey(backToDefault), project: h.admission.project };
  const release = h.admission.store.matters.focus(scope)!;
  const other = h.interactions.receive(h.actor('退款调查：继续核对退款资料'));
  assert.ok('request' in other);
  assert.equal(other.request.conversation, a.request.conversation);
  const vague = h.actor('就按刚才那个方案改吧。');
  assert.equal(h.interactions.receive(vague).status, 'matter-choice');
  assert.equal(h.admission.store.requestForMessage(vague), undefined);
  await h.restart();
  await drain(h);
  const defaultMessage = h.sent.find(row => row.options?.replyTo === backToDefault.id)!;
  const defaultCard = defaultMessage.options!.matterCard!;
  assert.ok(defaultCard.choices.some(choice => choice.id === 'default'));
  const card = h.sent.find(row => row.options?.replyTo === vague.id)!;
  const view = card.options!.matterCard!;
  assert.deepEqual(view.choices.map(choice => choice.id), [release, a.request.conversation]);
  const count = h.admission.store.requests().length;
  const click = { id: view.id, event: randomUUID(), tenant: view.tenant, user: view.user, chat: view.chat,
    message: 'delivered-' + card.id, choice: a.request.conversation };
  assert.equal(h.interactions.matterAction(click), 'accepted');
  assert.equal(h.interactions.matterAction(click), 'accepted');
  assert.equal(h.admission.store.requestForMessage(vague)?.conversation, a.request.conversation);
  assert.equal(h.admission.store.requests().length, count + 1);
  assert.equal(h.interactions.receive(vague).status, 'duplicate');
  const keepGoing = h.interactions.receive(h.actor('继续上一步'));
  assert.ok('request' in keepGoing);
  assert.equal(keepGoing.request.conversation, a.request.conversation);
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === vague.id && row.text === '已收到 · 退款调查').length, 1);
  assert.equal(h.interactions.matterAction({ ...click, id: defaultCard.id, event: randomUUID(),
    message: 'delivered-' + defaultMessage.id, choice: 'default' }), 'accepted');
  assert.equal(h.admission.store.requestForMessage(backToDefault)?.conversation, original.request.conversation);
  await drain(h);
  assert.equal(h.sent.filter(row => row.options?.replyTo === backToDefault.id && row.text === '已收到 · 默认对话').length, 1);
  assert.equal(h.codex.calls.length, 0);
});

test('short continuation follows ordinary admission history through empty switches and specialized work', t => {
  const h = setup(t);
  const initial = h.interactions.receive(h.actor('先查退款积压'));
  assert.ok('request' in initial);
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  h.interactions.receive(h.actor('/matter-new 文档整理'));
  const scope = { owner: ownerKey(initial.request.message), project: h.admission.project };
  const selected = h.admission.store.matters.focus(scope)!;
  const request = h.admission.receiveVerification(h.actor('/verify fixture inspect'), 'Inspect', { profile: 'fixture', definition: {
    projectRoot: h.admission.directory, engineRoot: h.admission.directory, projectId: 'fixture', suite: 'smoke',
    engineRevision: '0'.repeat(40), cliHash: '0'.repeat(64), libraryHash: '0'.repeat(64), timeoutMs: 1000,
    policyFiles: { 'ui-eval/project.json': '0'.repeat(64), 'ui-eval/engine.json': '0'.repeat(64), 'ui-eval/integrations/smoke.json': '0'.repeat(64) },
  } });
  assert.ok('request' in request);
  const first = h.actor('照之前那个做。');
  assert.equal(h.interactions.receive(first).status, 'matter-choice');
  assert.deepEqual(h.admission.store.matters.held(first, scope.project)?.choices, [selected, 'default']);

  const explicit = h.interactions.receive(h.actor('文档整理：核对导航'));
  assert.ok('request' in explicit);
  const specialized = h.admission.receiveVerification(h.actor('/verify fixture recheck'), 'Recheck', { profile: 'fixture',
    definition: h.admission.store.verification(request.request.execution)!.definition });
  assert.ok('request' in specialized);
  const next = h.interactions.receive(h.actor('继续。'));
  assert.ok('request' in next);
  assert.equal(next.request.conversation, selected);
});

test('conflicting answer titles and PRs wait for a verified choice and keep the chosen conversation after restart', async t => {
  const h = setup(t);
  h.interactions.receive(h.actor('/matter-new 退款调查'));
  const active = await h.launch();
  h.codex.complete(active.thread, active.turn, 'completed', 'Refund-only evidence');
  await active.running;
  await drain(h);
  const answer = h.sent.find(row => row.options?.replyTo === active.message.id && row.text === 'Refund-only evidence')!;
  const parentId = 'delivered-' + answer.id;

  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const release = h.admission.store.matters.focus({ owner: ownerKey(active.message), project: h.admission.project })!;
  const pr = 'https://github.com/example/release/pull/7';
  h.interactions.receive(h.actor('/matter-bind ' + pr));
  const titleConflict = h.actor('Solura 发版：核对放行条件', { parentId });
  const prConflict = h.actor('查一下 ' + pr, { parentId });
  const originalTask = h.actor(titleConflict.text, { parentId: active.message.id });
  const rejectedConflict = h.actor('Solura 发版：' + 'x'.repeat(29_980), { parentId });
  const count = h.admission.store.requests().length;

  for (const message of [titleConflict, prConflict, rejectedConflict]) {
    assert.equal(h.interactions.receive(message).status, 'matter-choice');
    assert.deepEqual(h.admission.store.matters.held(message, h.admission.project)?.choices, [active.request.conversation, release]);
    assert.equal(h.admission.store.requestForMessage(message), undefined);
  }
  await drain(h);
  await h.restart();
  assert.equal(h.interactions.receive(prConflict).status, 'matter-choice');
  assert.equal(h.admission.store.requests().length, count);

  const click = (message: typeof titleConflict, choice: string) => {
    const row = h.sent.find(item => item.options?.replyTo === message.id && item.options.matterCard)!;
    const card = row.options!.matterCard!;
    return { id: card.id, event: randomUUID(), tenant: card.tenant, user: card.user, chat: card.chat,
      message: 'delivered-' + row.id, choice };
  };
  const refused = click(rejectedConflict, active.request.conversation);
  assert.equal(h.interactions.matterAction(refused), 'accepted');
  assert.equal(h.admission.store.requestForMessage(rejectedConflict), undefined);
  assert.equal(h.admission.store.taskReply(JSON.stringify([rejectedConflict.tenant, rejectedConflict.id]))?.kind, 'rejected');
  assert.equal(h.admission.store.matters.focus({ owner: ownerKey(active.message), project: h.admission.project }), release);
  await drain(h);
  assert.ok(h.sent.some(row => row.options?.replyTo === rejectedConflict.id && row.text.includes('追问内容过长')));

  const source = click(titleConflict, active.request.conversation);
  assert.equal(h.interactions.matterAction({ ...source, event: randomUUID(), user: 'ou_admin' }), 'rejected');
  assert.equal(h.interactions.matterAction(source), 'accepted');
  const followup = h.admission.store.requestForMessage(titleConflict)!;
  assert.equal(followup.conversation, active.request.conversation);
  assert.equal(h.admission.store.conversationThread(followup.conversation), active.thread);
  assert.match(followup.input, /^本次用户追问：\n核对放行条件\n/);
  assert.match(followup.input, /Inspect this assigned task/);
  assert.equal(followup.message.text, titleConflict.text);

  const target = click(prConflict, release);
  assert.equal(h.interactions.matterAction(target), 'accepted');
  const admitted = h.admission.store.requestForMessage(prConflict)!;
  assert.equal(admitted.conversation, release);
  assert.equal(admitted.input, prConflict.text);
  assert.equal(h.admission.store.taskReply(JSON.stringify([prConflict.tenant, prConflict.id])), undefined);
  await h.restart();
  assert.equal(h.interactions.matterAction(source), 'accepted', 'the original callback result is retained');
  assert.equal(h.interactions.matterAction(refused), 'accepted');
  assert.equal(h.interactions.matterAction({ ...refused, event: randomUUID(), choice: release }), 'rejected');
  assert.equal(h.interactions.matterAction({ ...target, event: randomUUID(), choice: active.request.conversation }), 'rejected');
  assert.equal(h.admission.store.requests().length, count + 2);
  assert.equal(h.admission.store.matters.focus({ owner: ownerKey(active.message), project: h.admission.project }), release);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);

  const sourceTurn = await completeRequest(h, followup.id, 2);
  assert.equal(sourceTurn.threadId, active.thread);
  assert.deepEqual(sourceTurn.input, [{ type: 'text', text: followup.input, text_elements: [] }]);
  const targetTurn = await completeRequest(h, admitted.id, 3);
  assert.notEqual(targetTurn.threadId, active.thread);
  assert.deepEqual(targetTurn.input, [{ type: 'text', text: prConflict.text, text_elements: [] }]);

  assert.equal(h.interactions.receive(originalTask).status, 'task-reply', 'an exact original-task reply still wins');
  assert.equal(h.admission.store.requestForMessage(originalTask)?.conversation, active.request.conversation);
});

test('an ordinary answer becomes a reply anchor only when its Feishu delivery is confirmed', async t => {
  const h = setup(t, undefined, undefined, ['other']);
  h.interactions.receive(h.actor('/matter-new 退款调查'));
  const active = await h.launch();
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const attempted: string[] = [];
  let confirmed = false;
  h.setSend(async (chat, text, id, options) => {
    h.sent.push({ chat, text, id, options });
    if (text !== 'Refund answer before confirmation') return 'delivered-' + id;
    attempted.push(id);
    return confirmed ? 'refund-answer-message' : undefined;
  });
  h.codex.complete(active.thread, active.turn, 'completed', 'Refund answer before confirmation');
  await active.running;
  await drain(h);
  const early = h.actor('这个呢？', { parentId: 'refund-answer-message' });
  assert.equal(h.interactions.transport.state.confirmedAnswer(early), undefined);
  assert.equal(h.interactions.receive(early).status, 'matter-choice');
  const first = attempted[0];
  assert.ok(first);
  const transport = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  try {
    transport.exec(`CREATE TRIGGER fail_answer_binding BEFORE INSERT ON task_messages WHEN NEW.ordinary_answer=1
      BEGIN SELECT RAISE(ABORT,'fixture answer binding failure'); END;`);
    confirmed = true;
    transport.exec('UPDATE outbox SET next=0');
    await drain(h);
    assert.equal(h.interactions.transport.state.confirmedAnswer(early), undefined);
    assert.ok(transport.prepare('SELECT 1 FROM outbox WHERE id=?').get(first));
    transport.exec('DROP TRIGGER fail_answer_binding');
    transport.exec('UPDATE outbox SET next=0');
    await h.restart();
    await drain(h);
    assert.ok(attempted.length >= 3 && attempted.every(id => id === first));
    assert.equal(h.interactions.transport.state.confirmedAnswer(early), active.request.execution);
    assert.equal(h.interactions.receive(early).status, 'matter-choice');
    assert.equal(h.admission.store.requestForMessage(early), undefined);
    const outside = h.actor('other: check release', { parentId: 'refund-answer-message' });
    assert.deepEqual(h.interactions.receive(outside), { status: 'rejected', reason: 'outside_pilot' });
    h.interactions.receive(h.actor('/matter-new other'));
    assert.equal(h.interactions.receive(outside).status, 'ignored');
    assert.equal(h.admission.store.requestForMessage(outside), undefined);
    const conflictingAlias = h.actor(outside.text, { parentId: 'refund-answer-message' });
    assert.deepEqual(h.interactions.receive(conflictingAlias), { status: 'rejected', reason: 'outside_pilot' });
    assert.equal(h.admission.store.requestForMessage(conflictingAlias), undefined);
    const fresh = h.actor('这个呢？', { parentId: 'refund-answer-message' });
    assert.equal(h.interactions.receive(fresh).status, 'task-reply');
    assert.equal(h.admission.store.requestForMessage(fresh)?.conversation, active.request.conversation);
    let failedReaction = false;
    h.setAdd(async message => {
      assert.equal(message, fresh.id);
      failedReaction = true;
      throw Error('fixture reaction unavailable');
    });
    await drain(h);
    assert.equal(failedReaction, true);
    const notices = h.sent.filter(row => row.options?.replyTo === fresh.id);
    assert.equal(notices.length, 1);
    assert.match(notices[0]!.text, /事项 · 退款调查/);
  } finally { transport.close(); }
});

test('withdrawal does not change the admission history of a matter switch', async t => {
  for (const withdrawPrior of [true, false]) {
    const h = setup(t);
    h.config.approvalUsers = ['ou_owner'];
    h.config.approvalChat = 'chat';
    h.interactions.receive(h.actor('/matter-new 退款调查'));
    const prior = h.interactions.receive(h.actor('查询退款的积压情况'));
    assert.ok('request' in prior);
    h.interactions.receive(h.actor('/matter-new Solura 发版'));
    const scope = { owner: ownerKey(prior.request.message), project: h.admission.project };
    const selected = h.admission.store.matters.focus(scope)!;
    if (withdrawPrior) {
      assert.equal(h.interactions.receive(h.actor('/withdraw ' + prior.request.execution)).status, 'withdrawn');
    } else {
      const current = h.interactions.receive(h.actor('检查本次发布的构建记录'));
      assert.ok('request' in current);
      assert.equal(h.interactions.receive(h.actor('/withdraw ' + current.request.execution)).status, 'withdrawn');
    }
    await h.restart();
    const question = h.actor('继续上一步');
    const routed = h.interactions.receive(question);
    if (withdrawPrior) {
      assert.equal(routed.status, 'matter-choice');
      assert.deepEqual(h.admission.store.matters.held(question, scope.project)?.choices, [selected, prior.request.conversation]);
    } else {
      assert.ok('request' in routed);
      assert.equal(routed.request.conversation, selected);
    }
  }
});

test('confirming the current matter resolves its vague-follow-up guard across restart', async t => {
  const h = setup(t);
  h.interactions.receive(h.actor('/matter-new 退款调查'));
  assert.ok('request' in h.interactions.receive(h.actor('查询退款记录')));
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const latest = h.interactions.receive(h.actor('退款调查：核对退款明细'));
  assert.ok('request' in latest);
  assert.equal(h.interactions.receive(h.actor('那就继续。')).status, 'matter-choice');
  const list = h.actor('/matters');
  h.interactions.receive(list);
  await drain(h);
  const message = h.sent.find(row => row.options?.replyTo === list.id)!;
  const card = message.options!.matterCard!;
  const current = card.choices.find(choice => choice.label === '当前 · Solura 发版')!;
  const click = { id: card.id, event: randomUUID(), tenant: card.tenant, user: card.user, chat: card.chat,
    message: 'delivered-' + message.id, choice: current.id };
  assert.equal(h.interactions.matterAction(click), 'accepted');
  await h.restart();
  const followup = h.interactions.receive(h.actor('继续上一步'));
  assert.ok('request' in followup);
  assert.equal(followup.request.conversation, current.id);
});

test('a confirmed no-answer status is not an ordinary answer anchor', async t => {
  const h = setup(t);
  h.interactions.receive(h.actor('/matter-new 退款调查'));
  const active = await h.launch();
  h.codex.notify('turn/completed', { threadId: active.thread, turn: { id: active.turn, status: 'completed' } });
  await active.running;
  await drain(h);
  const message = h.sent.find(row => row.options?.replyTo === active.message.id && row.text.includes('没有拿到最终答复'))!;
  assert.ok(message);
  h.interactions.receive(h.actor('/matter-new Solura 发版'));
  const quote = h.actor('刚才那个呢？', { parentId: 'delivered-' + message.id });
  assert.equal(h.interactions.transport.state.confirmedAnswer(quote), undefined);
  assert.equal(h.interactions.receive(quote).status, 'matter-choice');
  assert.equal(h.admission.store.requestForMessage(quote), undefined);
});

test('registered PRs take precedence and an ambiguous input is published once after a confirmed choice', async t => {
  const h = setup(t);
  const a = h.actor('/matter-new Solura 发版');
  const b = h.actor('/matter-new Go Global 发版');
  h.interactions.receive(a);
  h.interactions.receive(h.actor('/matter-bind https://github.com/Org/solura-app/pull/9'));
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
  for (const text of [
    '检查 https://github.com/org/Solura-app/pull/9/files?diff=split',
    'Review https://github.com/Org/solura-app/pull/9.',
    'Check https://github.com/Org/solura-app/pull/9, focusing on CI.',
    '检查 https://github.com/Org/solura-app/pull/9,再看 CI',
    '检查 https://github.com/Org/solura-app/pull/9的 CI',
    '检查这个 PR（https://github.com/Org/solura-app/pull/9）',
    '检查这个 PR（https://github.com/Org/solura-app/pull/9/）',
    '检查「https://github.com/Org/solura-app/pull/9」的 CI',
    '检查 [对应 PR](https://github.com/Org/solura-app/pull/9)',
    'Review https://github.com/Org/solura-app/pull/9—check CI',
    '检查 **https://github.com/Org/solura-app/pull/9**',
    '检查 _https://github.com/Org/solura-app/pull/9_',
  ]) {
    const direct = h.interactions.receive(h.actor(text));
    assert.ok('request' in direct);
    assert.equal(direct.request.conversation, aView.anchor);
  }
  for (const text of [
    '检查 https://github.com/Org/solura-app/pull/9/comment',
    '检查 https://github.com/Org/solura-app/pull/9/详情',
    '检查 https://github.com/Org/solura-app/pull/9/_详情',
    '检查 https://github.com/Org/solura-app/pull/9/files_详情',
    '检查 https://github.com/Org/solura-app/pull/9/~',
    '检查 https://github.com/Org/solura-app/pull/9/✅',
    '检查 https://github.com/Org/solura-app/pull/2/../9',
    '检查 https://example.test/Org/solura-app/pull/9',
  ]) {
    const unrelated = h.interactions.receive(h.actor(text));
    assert.ok('request' in unrelated);
    assert.equal(unrelated.request.conversation, bView.anchor);
  }
  await drain(h);

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
  const next = h.interactions.receive(h.actor('检查这个版本的构建配置'));
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
    const unclear = h.actor('补充：检查发布记录', { parentId: 'visible-a-card' });
    assert.equal(h.interactions.receive(unclear).status, 'matter-choice');
    const rejected = h.actor('补充：先检查发布入口', { parentId: 'visible-a-card' });
    // Also preserve a legacy refusal that was only recorded in the transport ledger.
    assert.equal(h.interactions.transport.state.remember(rejected), true);
    assert.equal(h.admission.store.requestForMessage(unclear), undefined);
    acknowledge = true;
    transport.exec('UPDATE outbox SET next=0');
    await drain(h);
    assert.equal(h.interactions.receive(unclear).status, 'matter-choice');
    assert.equal(h.admission.store.requestForMessage(unclear), undefined);
    assert.equal(h.interactions.receive(rejected).status, 'duplicate');
    assert.equal(h.admission.store.requestForMessage(rejected), undefined);
    const fresh = h.interactions.receive(h.actor('补充：检查发布入口', { parentId: 'visible-a-card' }));
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
  const original = h.actor('backend: check release');
  const routed = h.interactions.receive(original);
  assert.ok('request' in routed);
  assert.equal(routed.request.input, 'check release');
  assert.equal(routed.request.conversation,
    h.admission.store.matters.named({ owner: ownerKey(newMatter), project: h.admission.project }, 'backend')!.id);
  assert.equal(routed.request.project, h.admission.project);
  const duplicate = h.interactions.receive(original);
  assert.equal(duplicate.status, 'duplicate');
  assert.ok('request' in duplicate);
  assert.equal(duplicate.request.id, routed.request.id);
  assert.equal(h.admission.store.retained(original), false);
  h.interactions.receive(h.actor('/matter-new Solura Release'));
  h.interactions.receive(h.actor('/matter-new Backend Release'));
  const refused = h.actor('other: check release');
  assert.deepEqual(h.interactions.receive(refused), { status: 'rejected', reason: 'outside_pilot' });
  assert.equal(h.admission.store.retained(refused), true);
  assert.equal(h.admission.store.matters.held(refused, h.admission.project), undefined);
  assert.equal(h.admission.store.matters.notice(refused), undefined);
  await drain(h);
  assert.equal(h.sent.some(row => row.options?.replyTo === refused.id), false);
  h.interactions.receive(h.actor('/matter-new other'));
  assert.equal(h.interactions.receive(refused).status, 'ignored');
  assert.equal(h.admission.store.requestForMessage(refused), undefined);
  assert.equal(h.admission.store.requests().length, 1);
  assert.ok('request' in h.interactions.receive(h.actor(refused.text)));

  const lostProjection = h.actor('backend: read CI');
  const transport = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'));
  try {
    transport.exec(`CREATE TRIGGER fail_task_projection BEFORE INSERT ON projected_tasks
      BEGIN SELECT RAISE(ABORT,'fixture task projection failure'); END;`);
    assert.throws(() => h.interactions.receive(lostProjection), /fixture task projection failure/);
    const admitted = h.admission.store.requestForMessage(lostProjection)!;
    assert.equal(admitted.conversation, routed.request.conversation);
    transport.exec('DROP TRIGGER fail_task_projection');
    const repaired = h.interactions.receive(lostProjection);
    assert.ok('request' in repaired && repaired.status === 'duplicate');
    assert.equal(repaired.request.id, admitted.id);
    assert.equal(h.admission.store.retained(lostProjection), false);
    assert.ok(transport.prepare('SELECT 1 FROM projected_tasks WHERE execution=?').get(admitted.execution));
  } finally { transport.close(); }
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

test('an unaddressed natural restriction steers the actual active task after a matter switch', async t => {
  const h = setup(t);
  h.interactions.receive(h.actor('/matter-new Release'));
  const active = await h.launch();
  h.interactions.receive(h.actor('/matter-new Follow-up'));
  const text = h.actor('只看日志');
  assert.equal(h.interactions.receive(text).status, 'control');
  await drain(h);
  const steers = h.codex.calls.filter(call => call.method === 'turn/steer');
  assert.equal(steers.length, 1);
  assert.equal(steers[0]?.params.threadId, active.thread);
  assert.equal(steers[0]?.params.expectedTurnId, active.turn);
  assert.equal(h.interactions.receive(text).status, 'duplicate');
  assert.equal(h.admission.store.requests().length, 1);
  h.codex.complete(active.thread, active.turn);
  await active.running;
});

test('explicit steering in a named private chat requires the quoted running task', async t => {
  const h = setup(t);
  const matter = h.actor('/matter-new Refund investigation');
  h.interactions.receive(matter);
  h.interactions.receive(h.actor('/matter-new Release'));
  await drain(h);
  const active = await h.launch();
  const card = h.sent.find(item => item.options?.replyTo === matter.id)!;
  assert.ok(card.options?.matterCard);
  for (const parentId of ['delivered-' + card.id, 'unconfirmed-parent']) {
    const control = h.actor('/steer 先不要发布', { parentId });
    assert.equal(h.interactions.receive(control).status, 'rejected');
    assert.equal(h.admission.store.control(control), undefined);
  }
  await drain(h);
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/steer').length, 0);
  const exact = h.actor('/steer 先查日志', { parentId: active.message.id });
  assert.equal(h.interactions.receive(exact).status, 'control');
  await drain(h);
  const steers = h.codex.calls.filter(call => call.method === 'turn/steer');
  assert.equal(steers.length, 1);
  assert.equal(steers[0]?.params.threadId, active.thread);
  assert.equal(steers[0]?.params.expectedTurnId, active.turn);
  h.codex.complete(active.thread, active.turn);
  await active.running;
});

test('refund milestones retain one private matter across failed projection acknowledgement and resume its native thread', async t => {
  const h = setup(t);
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/sls-refund-replay.json', import.meta.url), 'utf8'));
  const config = parseObserverConfig(fixture.source, 'replay');
  const directory = join(h.config.stateDirectory, 'sls-refund');
  let observer = new RefundObserver(directory, config.binding);
  t.after(() => observer.close());
  function apply(index: number) {
    const frame = fixture.frames[index];
    observer.acceptWindow(frame.from, frame.to, readEvaluations(frame.evaluations, config.binding), frame.now);
    const sample = observer.nextSample(frame.now);
    if (sample) observer.observe(sample, frame.now, readEvidence(frame.evidence));
  }
  function project() { projectRefundNotices(observer, h.admission, h.interactions.transport.state); }

  apply(0);
  for (const actor of [
    h.actor('/status', { chatType: 'group' }),
    h.actor('/status', { user: 'ou_other' }),
    h.actor('/status', { chat: 'different-private-chat' }),
  ]) {
    h.admission.confirmOwnerPrivateChat(actor);
    project();
    assert.equal(h.interactions.transport.state.drainStatus().outbox, 0);
  }
  assert.equal(h.admission.store.matters.list({ owner: ownerKey(h.actor('')), project: h.admission.project }, 1).length, 0);
  h.admission.confirmOwnerPrivateChat(h.actor('/status'));
  const loseAck = t.mock.method(observer, 'noticeProjected', () => { throw Error('lost projection acknowledgement'); });
  assert.throws(project, /lost projection acknowledgement/);
  loseAck.mock.restore();
  observer.close();
  observer = new RefundObserver(directory, config.binding);
  await h.restart();
  project();
  await drain(h);
  const cards = () => h.sent.filter(item => item.options?.matterCard?.source === 'sls-refund');
  assert.equal(cards().length, 1);
  const first = cards()[0]!;
  const matter = first.options!.matterCard!.anchor!;
  assert.equal(first.chat, h.admission.scope.chat);
  assert.equal(first.options?.replyTo, undefined);
  assert.match(first.text, /微信支付 · 待处理 1/);
  assert.doesNotMatch(first.text, /run_id|backlog-fixture/);
  assert.equal(h.admission.store.requests().length, 0);
  assert.equal(h.codex.calls.length, 0);
  const scope = { owner: ownerKey(h.actor('')), project: h.admission.project };
  assert.equal(h.admission.store.matters.focus(scope), undefined);
  const ordinary = h.interactions.receive(h.actor('Check local setup', { parentId: 'unrelated-message' }));
  assert.ok('request' in ordinary);
  assert.notEqual(ordinary.request.conversation, matter);

  assert.equal(h.interactions.receive(h.actor('Explain', { user: 'ou_other', parentId: 'delivered-' + first.id })).status, 'ignored');
  const reply = h.interactions.receive(h.actor('Explain the observed backlog', { parentId: 'delivered-' + first.id }));
  assert.ok('request' in reply);
  assert.equal(reply.request.conversation, matter);
  assert.match(reply.request.input, /历史 SLS 只读观测/);
  assert.match(reply.request.input, /微信支付 · 待处理 1/);
  const firstGrant = h.admission.store.reserve(reply.request.id, 81);
  assert.equal(firstGrant.kind, 'start');
  if (firstGrant.kind !== 'start') throw Error('Expected incident turn');
  const running = h.native.run(firstGrant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  const thread = String(h.codex.calls.find(call => call.method === 'turn/start')!.params.threadId);
  assert.equal(h.interactions.receive(h.actor('/steer apply elsewhere', { parentId: 'delivered-' + first.id })).status, 'rejected');
  assert.equal(h.interactions.receive(h.actor('/steer focus the report', { parentId: 'unrelated-message' })).status, 'control');
  fixture.frames.slice(1).forEach((_frame: unknown, index: number) => apply(index + 1));
  project();
  let interactedBeforeAcknowledgement = false;
  h.setSend(async (chat, text, id, options) => {
    h.sent.push({ chat, text, id, options });
    const message = 'delivered-' + id;
    if (options?.matterCard?.source === 'sls-refund') {
      interactedBeforeAcknowledgement = true;
      assert.equal(h.interactions.receive(h.actor('Could you explain?', { parentId: message })).status, 'matter-choice');
      assert.equal(h.interactions.receive(h.actor('/steer check recovery', { parentId: message })).status, 'rejected');
    }
    return message;
  });
  await drain(h);
  assert.ok(interactedBeforeAcknowledgement);
  h.codex.complete(thread, 'turn-2');
  await running;
  assert.equal(cards().length, 2);
  assert.match(cards()[1]!.options!.matterCard!.title, /观测确认恢复/);
  assert.equal(cards()[1]!.options!.matterCard!.anchor, matter);
  assert.equal(h.admission.store.requests().length, 2);
  await h.restart();
  const followup = h.interactions.receive(h.actor('Summarize the recovery', { parentId: 'delivered-' + cards()[1]!.id }));
  assert.ok('request' in followup);
  assert.equal(followup.request.conversation, matter);
  const nextGrant = h.admission.store.reserve(followup.request.id, 82);
  assert.equal(nextGrant.kind, 'start');
  if (nextGrant.kind !== 'start') throw Error('Expected incident follow-up turn');
  const resumed = h.native.run(nextGrant.permit);
  await until(() => h.codex.calls.filter(call => call.method === 'turn/start').length === 2);
  assert.equal(h.codex.calls.find(call => call.method === 'thread/resume')?.params.threadId, thread);
  await h.native.stop();
  await resumed;
});

test('the owner-private refund card displays a persisted diagnosis beside the original handoff status', async t => {
  const h = setup(t);
  const config = parseObserverConfig({ region: 'fixture', project: 'fixture', rule: 'refund', start: 100 }, 'replay');
  const directory = join(h.config.stateDirectory, 'sls-refund');
  const initial = new RefundObserver(directory, config.binding);
  try {
    initial.acceptWindow(100, 1006, [{ id: 'fire', at: 110, status: 'firing' }], 1006);
    initial.acceptWindow(1006, 1900, [{ id: 'quiet', at: 1899, status: 'inactive' }], 2000);
    const sample = initial.nextSample(2000)!;
    const row = { at: 1898, channel: 'alipay' as const, pending: 0, queryable: 0, missing: 0, oldestSeconds: 0 };
    assert.ok(initial.observe(sample, 2000, { backlog: [row], backlogRun: 'private-batch-reference',
      backlogSupplement: { status: 'matched', channel: 'wechat_pay', through: 1915,
        row: { ...row, at: 1904, channel: 'wechat_pay', pending: 1, queryable: 1, oldestSeconds: 1800 } } }));
  } finally { initial.close(); }

  const reopened = new RefundObserver(directory, config.binding);
  t.after(() => reopened.close());
  h.admission.confirmOwnerPrivateChat(h.actor('/status'));
  projectRefundNotices(reopened, h.admission, h.interactions.transport.state);
  await drain(h);
  const delivered = h.sent.filter(message => message.options?.matterCard?.source === 'sls-refund');
  assert.equal(delivered.length, 1);
  const [notice] = delivered;
  assert.equal(notice!.chat, h.admission.scope.chat);
  assert.match(notice!.options!.matterCard!.title, /需人工核对/);
  assert.match(notice!.text, /诊断补读 · 微信支付/);
  assert.match(notice!.text, /支付宝 · 待处理 0/);
  assert.match(notice!.text, /微信支付 · 待处理 1/);
  assert.match(notice!.text, /恢复判定仍使用原截止点内的证据/);
  assert.doesNotMatch(notice!.text, /private-batch-reference/);
  assert.equal(h.admission.store.requests().length, 0);
  assert.equal(h.codex.calls.length, 0);
});

test('managed refund observation retries a failed read and defers notifications through maintenance and shutdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(t);
  const config = parseObserverConfig({ region: 'fixture', project: 'fixture', rule: 'refund', start: 100 }, 'replay');
  const observer = new RefundObserver(join(h.config.stateDirectory, 'sls-refund'), config.binding);
  const error = t.mock.method(console, 'error', () => {});
  let iterations = 0;
  let finishRead: () => void = () => {};
  let diagnosticReads = 0;
  h.admission.confirmOwnerPrivateChat(h.actor('/status'));
  const monitor = new ManagedRefundObserver(observer, config, h.admission, h.interactions.transport.state, () => {},
    (store, source, options) => pollRefundObserver(store, source, {
      ...options, now: 220 + iterations * 120,
      read: async (_config, kind, from) => {
        if (kind === 'evidence') {
          diagnosticReads++;
          throw Error('diagnostics should not start after shutdown or pause');
        }
        iterations++;
        if (iterations === 1) throw Error('read failed');
        await new Promise<void>(resolve => { finishRead = resolve; });
        return JSON.stringify({ meta: { progress: 'Complete', isAccurate: true }, data: iterations === 2
          ? [{ AlertID: 'firing', AlertName: 'refund', AlertStatus: 'firing', __time__: String(from + 1) }]
          : [] });
      },
    }));
  t.after(async () => { finishRead(); await monitor.close(); });
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  monitor.start();
  await settle();
  assert.equal(error.mock.callCount(), 1);
  t.mock.timers.tick(120_000);
  assert.equal(iterations, 2);
  t.mock.timers.tick(240_000);
  assert.equal(iterations, 2);
  h.admission.store.maintenance.quiesce();
  finishRead();
  await settle();
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(iterations, 2);
  assert.ok(observer.report().incident);
  assert.equal(h.interactions.transport.state.drainStatus().outbox, 0);
  h.admission.store.maintenance.resume();
  t.mock.timers.tick(120_000);
  assert.equal(iterations, 3);
  const closing = monitor.close();
  finishRead();
  await closing;
  assert.equal(diagnosticReads, 0);
  assert.equal(h.interactions.transport.state.drainStatus().outbox, 0);
  assert.equal(h.admission.store.requests().length, 0);
});

test('SMQ notification starts an offline incident after a durable receipt, and restart processes it once without idle SLS scans', async t => {
  const now = 1_700_001_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1000 });
  const h = setup(t);
  const config = parseObserverConfig({ region: 'fixture', project: 'fixture', rule: 'refund', start: now - 7 * 86_400 }, 'replay');
  const directory = join(h.config.stateDirectory, 'sls-refund');
  h.admission.confirmOwnerPrivateChat(h.actor('/status'));
  const flushLoop = () => new Promise<void>(resolve => setImmediate(resolve));
  const event = { id: 'notice-spanning-gateway-downtime', at: now - 86_400 };
  let historyReads = 0;
  let evidenceReads = 0;
  let received = 0;
  const acknowledgements: string[] = [];
  t.mock.method(console, 'error', () => {});

  const poll: typeof pollRefundObserver = (ledger, source, options) => pollRefundObserver(ledger, source, {
    ...options, read: async (_config, kind, from, to) => {
      if (kind === 'evaluations') {
        historyReads++;
        assert.ok(from > now - 15 * 60, 'historical idle time is not walked minute by minute');
        assert.ok(to > from);
      } else evidenceReads++;
      return JSON.stringify({ meta: { progress: 'Complete', isAccurate: true }, data: [] });
    },
  });
  let ledger = new RefundObserver(directory, config.binding);
  const first = new ManagedRefundObserver(ledger, config, h.admission, h.interactions.transport.state, () => {}, poll, {
    receive: async () => ++received === 2 ? { ...event, receipt: 'failed-ack' } : undefined,
    acknowledge: async receipt => {
      acknowledgements.push(receipt);
      assert.equal(ledger.report().incident?.opened, event.at);
      assert.equal(ledger.through(), config.binding.start);
      assert.ok(ledger.notificationReadDue(now));
      throw new Error('queue acknowledgement lost');
    },
  });
  t.after(() => first.close());
  first.start();
  await flushLoop();
  assert.equal(historyReads, 0);
  t.mock.timers.tick(1000);
  await flushLoop();
  assert.deepEqual(acknowledgements, ['failed-ack']);
  const original = ledger.report().incident!.id;
  await first.close();

  ledger = new RefundObserver(directory, config.binding);
  const second = new ManagedRefundObserver(ledger, config, h.admission, h.interactions.transport.state, () => {}, poll, {
    receive: async () => ++received === 3 ? { ...event, receipt: 'fresh-receipt' } : undefined,
    acknowledge: async receipt => { acknowledgements.push(receipt); },
  });
  t.after(() => second.close());
  second.start();
  await flushLoop();
  t.mock.timers.tick(1000);
  await flushLoop();
  assert.deepEqual(acknowledgements, ['failed-ack', 'fresh-receipt']);
  assert.equal(ledger.report().incident?.id, original);
  assert.equal(ledger.report().incident?.observations.length, 1);
  assert.equal(ledger.notificationReadDue(now), false);
  assert.equal(historyReads, 1);
  assert.equal(evidenceReads, 1);
  await drain(h);
  assert.equal(h.sent.filter(message => message.options?.matterCard?.anchor === original).length, 1);
  assert.equal(h.admission.store.requests().length, 0);
  assert.equal(h.codex.calls.length, 0);

  t.mock.timers.tick(299_000);
  await flushLoop();
  t.mock.timers.tick(600_000);
  await flushLoop();
  await drain(h);
  assert.deepEqual(ledger.report().incident?.observations.map(item => item.slot), [0, 1, 2]);
  assert.equal(ledger.report().incident?.state, 'needs-attention');
  assert.equal(historyReads, 3);
  assert.equal(evidenceReads, 3);
  assert.equal(h.sent.filter(message => message.options?.matterCard?.anchor === original).length, 2);
  assert.equal(h.admission.store.requests().length, 0);
  await second.close();
});

test('SMQ receipt arriving during maintenance remains available for redelivery', async t => {
  const h = setup(t);
  const now = Math.floor(Date.now() / 1000);
  const config = parseObserverConfig({ region: 'fixture', project: 'fixture', rule: 'refund', start: now - 360 }, 'replay');
  const ledger = new RefundObserver(join(h.config.stateDirectory, 'sls-refund'), config.binding);
  let settle = () => {};
  const delivery = new Promise<{ id: string; at: number; receipt: string }>(resolve => {
    settle = () => resolve({ id: 'paused-firing', at: now - 1, receipt: 'unconfirmed' });
  });
  let received = 0;
  let acknowledged = 0;
  const monitor = new ManagedRefundObserver(ledger, config, h.admission, h.interactions.transport.state, () => {},
    async () => { throw new Error('Unscheduled SLS read'); },
    { receive: () => { received++; return delivery; }, acknowledge: async () => { acknowledged++; } });
  t.after(async () => { settle(); await monitor.close(); });
  monitor.start();
  assert.equal(received, 1);
  h.admission.store.maintenance.quiesce();
  settle();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(acknowledged, 0);
  assert.equal(ledger.report().incident, null);
  assert.equal(h.interactions.transport.state.drainStatus().outbox, 0);
  await monitor.close();
});

test('unavailable SLS evidence does not block the next durable SMQ firing', async t => {
  const now = 1_700_001_000;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: now * 1000 });
  const h = setup(t);
  h.admission.confirmOwnerPrivateChat(h.actor('/status'));
  const config = parseObserverConfig({ region: 'fixture', project: 'fixture', rule: 'refund', start: now - 360 }, 'replay');
  const ledger = new RefundObserver(join(h.config.stateDirectory, 'sls-refund'), config.binding);
  let receives = 0, reads = 0;
  const acknowledged: string[] = [];
  t.mock.method(console, 'error', () => {});
  const monitor = new ManagedRefundObserver(ledger, config, h.admission, h.interactions.transport.state, () => {},
    async () => { reads++; throw Error('SLS unreachable'); }, {
      receive: async () => {
        const sequence = ++receives;
        if (sequence <= 2) return { id: 'firing-' + sequence, at: now - 90 + sequence, receipt: String(sequence) };
      },
      acknowledge: async receipt => { acknowledged.push(receipt); },
    });
  t.after(() => monitor.close());
  monitor.start();
  const settle = () => new Promise<void>(resolve => setImmediate(resolve));
  await settle();
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(acknowledged, ['1', '2']);
  assert.equal(ledger.report().evaluations, 2);
  assert.equal(reads, 1);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(receives, 3);
  assert.equal(reads, 1);
  await drain(h);
  assert.equal(h.sent.filter(message => message.options?.matterCard?.source === 'sls-refund').length, 1);
  assert.equal(h.admission.store.requests().length, 0);
  await monitor.close();
});
