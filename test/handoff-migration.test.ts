import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { State } from '../src/state.js';
import { Bridge } from '../src/bridge.js';
import { PilotAdmission } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { pilotMaintenance } from '../src/handoff/maintenance.js';
import { loadMigrationPlan, stageHandoff, rollbackHandoff } from '../src/handoff/migration.js';
import { acquireRoot, manageRuntime, openRuntimeControl, readFence, writePrivate, controllerFile, fenceFile } from '../src/handoff/ownership.js';
import { CODEX_VERSION } from '../src/codex/generated/version.js';
import { FakeCodex, until } from './helpers.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.generation = randomUUID(); }
  async close() { this.exit(); }
}

async function fixture(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-migration-')));
  const legacyDirectory = join(root, 'legacy'), project = join(root, 'project');
  mkdirSync(legacyDirectory); mkdirSync(project);
  const configPath = join(root, 'bridge.config.json');
  writeFileSync(configPath, JSON.stringify({ allowedUsers: ['ou_fixture_owner'], allowedTenant: 'fixture-tenant', enableGroups: false,
    projects: { pilot: project }, projectRouting: 'manual', stateDirectory: legacyDirectory }));
  const state = new State(legacyDirectory);
  const message = { tenant: 'fixture-tenant', user: 'ou_fixture_owner', chat: 'oc_fixture_chat', id: 'legacy-source', text: 'Legacy completed task' };
  const session = state.select(message, 'pilot', project);
  state.setThread(session.id, 'retained-native-thread');
  state.remember(message);
  const task = state.enqueue(session.id, message.text, { id: message.id }, undefined, undefined, true);
  state.taskStatus(task.id, 'completed', 'legacy-turn'); state.feedbackFinished(task.id);
  state.send(message.chat, 'Legacy answer', { taskId: task.id, replyTo: message.id, final: true });
  state.delivered(state.pending()[0]!.id, 'legacy-answer');
  state.maintenance.quiesce(); state.close();
  const lease = await acquireRoot(legacyDirectory, 'legacy', legacyDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  const planPath = join(root, 'plan.json');
  const raw = { version: 1, bridgeConfig: configPath, pilotDirectory: join(root, 'pilot'), bundleDirectory: join(root, 'bundle'),
    scope: { installation: 'fixture', tenant: message.tenant, operator: message.user, chat: message.chat, projects: { pilot: project }, pilot: 'pilot',
      hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' },
    botOpenId: 'ou_fixture_bot', sourceSession: session.id, workerClosureReference: 'Fixture services and native processes were closed' };
  writeFileSync(planPath, JSON.stringify(raw));
  const plan = loadMigrationPlan(planPath);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, plan, planPath, raw, message, session, task };
}

function read<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path, { readOnly: true }); try { return work(db); } finally { db.close(); }
}

test('quiesced legacy tasks drain while new requests stay durably rejected', async t => {
  const h = await fixture(t); const state = new State(h.plan.legacyDirectory); const codex = new FakeCodex();
  const bridge = new Bridge(h.plan.config, state, codex);
  const actor = (text: string) => ({ ...h.message, id: randomUUID(), text });
  state.maintenance.resume(); bridge.receive(actor('An existing task'));
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  state.maintenance.quiesce();
  const held = actor('New work while maintenance'); bridge.receive(held);
  bridge.receive(actor('/steer Keep the existing task constrained'));
  await until(() => codex.calls.some(call => call.method === 'turn/steer'));
  assert.equal(codex.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal(state.drainStatus().running, 1);
  bridge.receive(actor('/stop')); await until(() => state.drainStatus().running === 0);
  state.maintenance.resume(); bridge.receive(held);
  assert.equal(codex.calls.filter(call => call.method === 'turn/start').length, 1);
  await bridge.close(); state.close();
});

test('closed import and rollback before traffic preserve native ownership and old reply associations', async t => {
  const h = await fixture(t);
  const before = readFileSync(join(h.plan.legacyDirectory, 'bridge.db'));
  await stageHandoff(h.plan);
  assert.deepEqual(readFileSync(join(h.plan.legacyDirectory, 'bridge.db')), before);
  assert.equal((await stageHandoff(h.plan)).repeated, true);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
  await assert.rejects(acquireRoot(h.plan.legacyDirectory, 'legacy', h.plan.legacyDirectory), /own/);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  assert.equal(admission.receive(h.message).status, 'ignored');
  assert.equal(admission.store.conversationThread(h.session.id), 'retained-native-thread');
  assert.equal(admission.store.maintenance.paused, true);
  const transport = new State(join(h.plan.pilotDirectory, 'transport'));
  assert.equal(transport.referencedTask('legacy-answer', h.session.owner), h.task.id);
  transport.close(); admission.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'before-traffic');
  assert.deepEqual(readFileSync(join(h.plan.legacyDirectory, 'bridge.db')), before);
  assert.equal((await rollbackHandoff(h.plan)).repeated, true);
  assert.equal((await stageHandoff(h.plan)).staged, false);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'legacy');
});

test('rollback treats empty additive tables as compatible with an older staged baseline', async t => {
  const h = await fixture(t);
  const original = readFileSync(join(h.plan.legacyDirectory, 'bridge.db'));
  await stageHandoff(h.plan);

  const db = new DatabaseSync(join(h.plan.pilotDirectory, 'handoff.db'));
  db.exec('DROP TABLE delivery_checkpoints; DROP TABLE inbound_attachments');
  const oldTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='maintenance' ORDER BY name").all() as { name: string }[];
  const canonical = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  const oldFacts = oldTables.map(({ name }) => ({
    name, rows: db.prepare('SELECT * FROM "' + name + '"').all().map(canonical).sort(),
  }));
  db.close();
  const bundle = join(h.plan.bundleDirectory, 'handoff-bundle.json');
  const metadata = JSON.parse(readFileSync(bundle, 'utf8'));
  metadata.pilotFacts = createHash('sha256').update(canonical(oldFacts)).digest('hex');
  writeFileSync(bundle, JSON.stringify(metadata));

  assert.equal((await rollbackHandoff(h.plan)).window, 'before-traffic');
  assert.deepEqual(readFileSync(join(h.plan.legacyDirectory, 'bridge.db')), original);
});

test('rollback requires a committed attachment registration to be projected before downgrading', async t => {
  const h = await fixture(t);
  await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  const id = 'om_fixture_file';
  assert.equal(admission.store.registerAttachment({ ...h.message, id, chatType: 'p2p', text: '[文件附件]',
    attachment: { messageId: id, key: 'file_fixture', name: 'fixture.pdf' } }), true);
  admission.close();
  await assert.rejects(rollbackHandoff(h.plan), /Committed file receipt has not been projected/);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
});

test('post-traffic rollback imports deduplication, native continuation and delivered reply associations', async t => {
  const h = await fixture(t);
  const history = new State(h.plan.legacyDirectory);
  const newer = history.select(h.message, 'pilot', h.session.directory, true);
  history.setThread(newer.id, 'newer-unselected-thread'); history.close();
  await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  admission.store.maintenance.resume();
  const codex = new ManagedFake(); const native = new NativeExecutions(admission, h.plan.config, () => codex);
  const sent: string[] = [];
  let card: import('../src/approval.js').ApprovalPresentation | undefined, cardMessage: string | undefined;
  const interactions = new PilotInteractions(admission, h.plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) }, native,
    { send: async (_chat, _text, id, options) => { sent.push(id); if (options?.approval) { card = options.approval; cardMessage = 'pilot-answer-' + id; } return 'pilot-answer-' + id; }, updateApproval: async () => {} },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  const message = { ...h.message, id: 'pilot-source', text: 'Continue native work', chatType: 'p2p' as const };
  const accepted = interactions.receive(message); assert.ok('request' in accepted);
  admission.store.rememberEvent(accepted.request.id, 1); admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = native.run(grant.permit);
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  assert.equal(codex.calls.find(call => call.method === 'thread/resume')!.params.threadId, 'retained-native-thread');
  codex.ask('card-native', 'item/commandExecution/requestApproval', { threadId: 'retained-native-thread', turnId: 'turn-1', command: 'echo card-fixture' });
  for (let i = 0; i < 8; i++) await interactions.flush();
  assert.ok(card && cardMessage);
  const callback = { event: randomUUID(), tenant: message.tenant, user: message.user, chat: message.chat, message: cardMessage, id: card.id, decision: 'reject' as const };
  assert.equal(interactions.cardAction(callback), 'accepted');
  for (let i = 0; i < 8; i++) await interactions.flush();
  assert.deepEqual(codex.replies, [{ id: 'card-native', result: { decision: 'decline' } }]);
  const controlMessage = { ...message, id: 'pilot-control', text: '/steer Keep this constraint' };
  interactions.receive(controlMessage); await interactions.flush();
  codex.complete('retained-native-thread', 'turn-1'); await running;
  const processMetadata = Buffer.from(JSON.stringify({ version: 1, observation: 'fixture-private-process-evidence' }));
  writeFileSync(join(h.plan.pilotDirectory, 'executions', accepted.request.execution, 'native-processes.json'), processMetadata, { mode: 0o600 });
  for (let i = 0; i < 6; i++) await interactions.flush();
  admission.store.maintenance.quiesce();
  await interactions.close(); admission.close();
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const operation = JSON.parse(readFileSync(join(h.plan.bundleDirectory, 'handoff-operation.json'), 'utf8'));
  const archived = read(join(h.plan.bundleDirectory, operation.archive, 'transport.db'), db => db.prepare('SELECT id,message,rendered FROM approval_cards').get());
  assert.deepEqual({ ...archived }, { id: card.id, message: cardMessage, rendered: 'rejected' });
  assert.deepEqual(readFileSync(join(h.plan.bundleDirectory, operation.archive, accepted.request.execution, 'native-processes.json')), processMetadata);
  assert.equal(operation.nativeFiles[accepted.request.execution + '/native-processes.json'], createHash('sha256').update(processMetadata).digest('hex'));
  const restored = new State(h.plan.legacyDirectory);
  assert.equal(restored.remember(message), false);
  assert.equal(restored.remember(controlMessage), false);
  assert.equal(restored.remember({ ...message, id: 'card/' + callback.event }), false);
  assert.equal(restored.selected(message)!.thread, 'retained-native-thread');
  assert.equal(restored.referencedTask('pilot-answer-' + sent.at(-1), h.session.owner), accepted.request.execution);
  assert.equal(restored.referencedTask('legacy-answer', h.session.owner), h.task.id);
  assert.equal(restored.drainStatus().queued, 0); assert.equal(restored.maintenance.paused, true);
  restored.close();
  assert.equal(read(join(h.plan.legacyDirectory, 'bridge.db'), db => Number((db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n)), 2);
  const continued = new State(h.plan.legacyDirectory);
  continued.maintenance.resume();
  const nextCodex = new FakeCodex(); const nextBridge = new Bridge(h.plan.config, continued, nextCodex);
  nextBridge.receive(message); nextBridge.receive(controlMessage);
  assert.equal(nextCodex.calls.length, 0);
  nextBridge.receive({ ...message, id: 'fresh-after-rollback', text: 'pilot: Continue after rollback' });
  await until(() => nextCodex.calls.some(call => call.method === 'turn/start'));
  assert.equal(nextCodex.calls.find(call => call.method === 'thread/resume')!.params.threadId, 'retained-native-thread');
  nextCodex.complete('retained-native-thread', 'turn-1'); await nextBridge.close(); continued.close();
  const selection = new State(h.plan.legacyDirectory);
  assert.equal(selection.select(message, 'alternate-alias', h.session.directory).thread, 'retained-native-thread');
  const fresh = selection.select(message, 'pilot', h.session.directory, true);
  assert.notEqual(fresh.id, h.session.id);
  assert.equal(selection.select(message, 'pilot', h.session.directory).id, fresh.id);
  selection.close();
  assert.equal((await rollbackHandoff(h.plan)).repeated, true);
});

test('active ownership, pending output and unresolved effects prevent a handoff', async t => {
  const h = await fixture(t);
  const lease = await acquireRoot(h.plan.legacyDirectory, 'legacy', h.plan.legacyDirectory);
  await assert.rejects(stageHandoff(h.plan), { code: 'ELOCKED' }); await lease.release();
  const state = new State(h.plan.legacyDirectory);
  state.send(h.message.chat, 'Undelivered output'); state.close();
  await assert.rejects(stageHandoff(h.plan), /drained/);
  const clear = new State(h.plan.legacyDirectory); clear.delivered(clear.pending()[0]!.id);
  clear.taskStatus(h.task.id, 'unknown'); clear.close();
  await assert.rejects(stageHandoff(h.plan), /drained/);
  const reconciled = new State(h.plan.legacyDirectory); reconciled.reconcileForMigration(h.task.id, 'Inspected fixture process and effects'); reconciled.close();
  await stageHandoff(h.plan);
});

test('ownership and snapshot tampering are rejected before restored state is published', async t => {
  const h = await fixture(t);
  writeFileSync(h.planPath, JSON.stringify({ ...h.raw, sourceSession: 'unowned-session' }));
  const wrong = loadMigrationPlan(h.planPath); await assert.rejects(stageHandoff(wrong), /conversation/);
  const validPath = join(h.root, 'second-plan.json');
  writeFileSync(validPath, JSON.stringify({ ...h.raw, bundleDirectory: join(h.root, 'second-bundle') }));
  const plan = loadMigrationPlan(validPath); await stageHandoff(plan);
  const snapshot = join(plan.bundleDirectory, 'legacy.db'); chmodSync(snapshot, 0o600);
  writeFileSync(snapshot, Buffer.concat([readFileSync(snapshot), Buffer.from('changed')]));
  await assert.rejects(rollbackHandoff(plan), /snapshot changed/);
  assert.equal(readFence(plan.legacyDirectory)!.role, 'pilot');
});

test('a controlled subprocess provides authenticated maintenance and exclusive root ownership', async t => {
  const h = await fixture(t);
  const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/managed-runtime.ts', h.plan.legacyDirectory], {
    cwd: process.cwd(), env: { ...process.env, NODE_TEST_CONTEXT: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false; child.stdout.on('data', data => { if (String(data).includes('READY')) ready = true; });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  await until(() => ready);
  assert.equal((await manageRuntime(h.plan.legacyDirectory, 'quiesce')).paused, true);
  await assert.rejects(stageHandoff(h.plan), { code: 'ELOCKED' });
  await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
  await stageHandoff(h.plan);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
});

test('wrong protocol and an unconfirmed runtime closure retain the current owner', async t => {
  const h = await fixture(t);
  writePrivate(join(h.plan.legacyDirectory, controllerFile), { version: 1, protocol: CODEX_VERSION, root: h.plan.legacyDirectory,
    role: 'legacy', data: h.plan.legacyDirectory, phase: 'active' });
  await assert.rejects(stageHandoff(h.plan), /closure/);
  writePrivate(join(h.plan.legacyDirectory, controllerFile), { version: 1, protocol: 'incompatible', root: h.plan.legacyDirectory,
    role: 'legacy', data: h.plan.legacyDirectory, phase: 'closed' });
  await assert.rejects(stageHandoff(h.plan), /closure/);
});

test('prepared import and replaced legacy state recover after an interrupted owner-role commit', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  const staged = readFence(h.plan.legacyDirectory)!;
  // The prepared target exists, while the final owner-role write was lost.
  rmSync(join(h.plan.legacyDirectory, fenceFile));
  assert.equal((await stageHandoff(h.plan)).staged, true);
  assert.equal((await rollbackHandoff(h.plan)).restored, true);
  // The restored SQLite file was committed, while ownership still names the pilot.
  writePrivate(join(h.plan.legacyDirectory, fenceFile), staged);
  writePrivate(join(h.plan.legacyDirectory, controllerFile), { version: 1, protocol: CODEX_VERSION, root: h.plan.legacyDirectory,
    role: 'pilot', data: h.plan.pilotDirectory, phase: 'closed' });
  assert.equal((await rollbackHandoff(h.plan)).restored, true);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'legacy');
  // Closure was updated for legacy, while the final role commit was interrupted.
  writePrivate(join(h.plan.legacyDirectory, fenceFile), staged);
  assert.equal((await rollbackHandoff(h.plan)).restored, true);
});

test('a prepared export can resume before its database copy is present', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  rmSync(join(h.plan.legacyDirectory, fenceFile));
  rmSync(join(h.plan.bundleDirectory, 'legacy.db'));
  assert.equal((await stageHandoff(h.plan)).staged, true);
  assert.ok(readFileSync(join(h.plan.bundleDirectory, 'legacy.db')).length);
});

test('the CLI stages the handoff and the ordinary runtime entry rejects the old role before connecting', async t => {
  const h = await fixture(t);
  const run = (args: string[], env = process.env) => new Promise<{ code: number | null; output: string }>(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
    child.once('exit', code => resolve({ code, output }));
  });
  const staged = await run(['src/handoff/migrate-cli.ts', 'stage', h.planPath]);
  assert.equal(staged.code, 0, staged.output);
  const old = await run(['src/index.ts'], { ...process.env, NODE_TEST_CONTEXT: '', BRIDGE_CONFIG: String(h.raw.bridgeConfig),
    FEISHU_APP_ID: 'cli_0000000000000000', FEISHU_APP_SECRET: 'fixture-app-secret' });
  assert.equal(old.code, 1); assert.match(old.output, /does not own/);
  const restored = await run(['src/handoff/migrate-cli.ts', 'rollback', h.planPath]);
  assert.equal(restored.code, 0, restored.output);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'legacy');
});

test('an explicitly fresh pilot conversation returns as a new legacy session', async t => {
  const h = await fixture(t);
  writeFileSync(h.planPath, JSON.stringify({ ...h.raw, sourceSession: null }));
  const plan = loadMigrationPlan(h.planPath); await stageHandoff(plan);
  const admission = new PilotAdmission(plan.pilotDirectory, plan.scope); admission.store.maintenance.resume();
  const codex = new ManagedFake(); const native = new NativeExecutions(admission, plan.config, () => codex);
  const interactions = new PilotInteractions(admission, plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) }, native,
    { send: async (_chat, _text, id) => 'fresh-answer-' + id },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  const message = { ...h.message, id: 'fresh-conversation-source', text: 'Use the new conversation' };
  const accepted = interactions.receive(message); assert.ok('request' in accepted);
  admission.store.rememberEvent(accepted.request.id, 1); admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = native.run(grant.permit);
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  assert.ok(!codex.calls.some(call => call.method === 'thread/resume'));
  codex.complete('thread-1', 'turn-2'); await running;
  for (let i = 0; i < 5; i++) await interactions.flush();
  admission.store.maintenance.quiesce(); await interactions.close(); admission.close();
  const lease = await acquireRoot(plan.legacyDirectory, 'pilot', plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  await rollbackHandoff(plan);
  const restored = new State(plan.legacyDirectory);
  assert.equal(restored.selected(message)!.thread, 'thread-1');
  assert.equal(restored.session(h.session.id).thread, 'retained-native-thread');
  assert.equal(restored.remember(message), false); restored.close();
});

test('completed historical tasks with nullable source fields retain their existing reply links', async t => {
  const h = await fixture(t);
  const db = new DatabaseSync(join(h.plan.legacyDirectory, 'bridge.db'));
  db.prepare('UPDATE tasks SET trigger_message=NULL,source=NULL WHERE id=?').run(h.task.id); db.close();
  await stageHandoff(h.plan);
  const transport = new State(join(h.plan.pilotDirectory, 'transport'));
  assert.equal(transport.referencedTask('legacy-answer', h.session.owner), h.task.id); transport.close();
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  assert.equal(admission.receive(h.message).status, 'ignored'); admission.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'before-traffic');
});

test('a missing prepared database is rejected without recreating an empty pilot', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  rmSync(join(h.plan.pilotDirectory, 'handoff.db'));
  await assert.rejects(rollbackHandoff(h.plan), /ENOENT|missing/);
  await assert.rejects(stageHandoff(h.plan), /ENOENT|missing/);
  assert.throws(() => readFileSync(join(h.plan.pilotDirectory, 'handoff.db')), { code: 'ENOENT' });
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
});

test('managed pilot recovers first-turn conversation after owner death and supports audited reconciliation before rollback', async t => {
  const h = await fixture(t);
  writeFileSync(h.planPath, JSON.stringify({ ...h.raw, sourceSession: null }));
  const plan = loadMigrationPlan(h.planPath); await stageHandoff(plan);
  const admission = new PilotAdmission(plan.pilotDirectory, plan.scope);
  admission.store.maintenance.resume();
  const message = { ...h.message, id: 'lost-first-turn', text: 'Begin a fresh conversation' };
  const accepted = admission.receive(message); assert.ok('request' in accepted);
  admission.store.rememberEvent(accepted.request.id, 1); admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const assignment = join(h.root, 'assignment.json');
  writeFileSync(assignment, JSON.stringify({ config: plan.config, scope: plan.scope, directory: plan.pilotDirectory, permit: grant.permit }));
  const owner = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/assigned-owner.ts', assignment], { stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false; owner.stdout.on('data', data => { if (String(data).includes('READY')) ready = true; });
  t.after(() => { if (owner.exitCode === null) owner.kill('SIGKILL'); });
  await until(() => ready);
  assert.equal(admission.store.conversationThread(accepted.request.conversation), null);
  const exited = new Promise(resolve => owner.once('exit', resolve)); owner.kill('SIGKILL'); await exited;
  const native = new NativeExecutions(admission, plan.config);
  const interactions = new PilotInteractions(admission, plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) }, native,
    { send: async (_chat, _text, id) => id }, { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  await interactions.recover(); for (let i = 0; i < 3; i++) await interactions.flush();
  const thread = admission.store.conversationThread(accepted.request.conversation);
  assert.equal(thread, 'thread-1');
  assert.equal(admission.store.execution(grant.permit.execution)!.status, 'unknown');
  assert.equal(admission.store.unsettled().length, 1);
  await interactions.close(); admission.close();
  const runtime = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/managed-runtime.ts', plan.legacyDirectory, h.planPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  ready = false; runtime.stdout.on('data', data => { if (String(data).includes('READY')) ready = true; });
  t.after(() => { if (runtime.exitCode === null) runtime.kill('SIGKILL'); });
  await until(() => ready);
  assert.deepEqual((await manageRuntime(plan.legacyDirectory, 'status')).uncertain, [grant.permit.execution]);
  await assert.rejects(manageRuntime(plan.legacyDirectory, 'reconcile', grant.permit.execution), /reply/);
  const result = await manageRuntime(plan.legacyDirectory, 'reconcile', grant.permit.execution, 'Inspected killed fixture owner, native journal and project effects');
  assert.equal(result.guards, 0);
  assert.equal((await manageRuntime(plan.legacyDirectory, 'quiesce')).paused, true);
  const closed = new Promise(resolve => runtime.once('exit', resolve)); runtime.kill('SIGTERM'); await closed;
  assert.equal((await rollbackHandoff(plan)).window, 'after-traffic');
  const restored = new State(plan.legacyDirectory);
  assert.equal(restored.select(message, 'pilot', h.session.directory).thread, thread);
  assert.equal(restored.drainStatus().unknown, 0);
  restored.maintenance.resume();
  const continued = new FakeCodex(); const bridge = new Bridge(plan.config, restored, continued);
  bridge.receive({ ...message, id: 'continue-inspected-loss', text: 'pilot: Continue the inspected remaining work' });
  await until(() => continued.calls.some(call => call.method === 'turn/start'));
  assert.equal(continued.calls.find(call => call.method === 'thread/resume')!.params.threadId, thread);
  continued.complete(thread!, 'turn-1'); await bridge.close();
  restored.close();
});

test('rollback refuses unprojected and undelivered recovery decisions before retaining their acknowledged identity', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope); admission.store.maintenance.resume();
  const codex = new ManagedFake(), native = new NativeExecutions(admission, h.plan.config, () => codex);
  const interactions = new PilotInteractions(admission, h.plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) }, native,
    { send: async (_chat, _text, id) => 'fixture-ack-' + id },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  const message = { ...h.message, chatType: 'p2p' as const, id: 'unknown-before-rollback', text: 'Controlled uncertain task' };
  const accepted = interactions.receive(message); assert.ok('request' in accepted);
  admission.store.rememberEvent(accepted.request.id, 1); admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = native.run(grant.permit); await until(() => codex.calls.some(call => call.method === 'turn/start'));
  codex.exit(); const report = await running;
  for (let i = 0; i < 6; i++) await interactions.flush();
  const confirm = { ...message, id: 'inspected-before-rollback', text: '/recover ' + accepted.request.execution + ' inspected fixture processes and effects' };
  interactions.receive(confirm); await until(() => admission.store.recoveries().length === 1);
  admission.store.maintenance.quiesce();
  // Simulate an older/crashed runtime that closed without projecting its committed decision.
  await interactions.transport.close(); admission.close();
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  await assert.rejects(rollbackHandoff(h.plan), /recovery notice.*projected/);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
  const pending = new State(join(h.plan.pilotDirectory, 'transport'));
  pending.projectRecoveryNotice(JSON.stringify([confirm.tenant, confirm.id]), confirm); pending.close();
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  const delivered = new State(join(h.plan.pilotDirectory, 'transport'));
  const notice = delivered.pending().find(row => row.replyTo === confirm.id)!; assert.ok(notice);
  delivered.delivered(notice.id, 'recovery-ack'); delivered.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const restored = new State(h.plan.legacyDirectory);
  assert.equal(restored.remember(confirm), false); assert.equal(restored.remember(message), false);
  assert.equal(restored.selected(message)!.thread, report.outcome.thread);
  assert.equal(restored.drainStatus().queued, 0); restored.close();
});

test('rollback requires withdrawn-request notice delivery and preserves skipped verification audit without restoring queued work', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope); admission.store.maintenance.resume();
  const message = { ...h.message, chatType: 'p2p' as const, id: 'queued-before-withdrawal', text: 'Unstarted fixture task' };
  const accepted = admission.receiveVerification(message, message.text, { profile: 'withdrawn-fixture', definition: {
    projectRoot: h.plan.scope.projects.pilot!, engineRoot: h.plan.scope.projects.pilot!, projectId: 'fixture', suite: 'smoke',
    engineRevision: '0'.repeat(40), cliHash: '0'.repeat(64), libraryHash: '0'.repeat(64), timeoutMs: 1000,
    policyFiles: { 'ui-eval/project.json': '0'.repeat(64), 'ui-eval/engine.json': '0'.repeat(64), 'ui-eval/integrations/smoke.json': '0'.repeat(64) },
  } }); assert.ok('request' in accepted);
  const command = { ...message, id: 'withdraw-before-rollback', text: '/withdraw ' + accepted.request.execution };
  const receipt = admission.store.withdraw(command, accepted.request.execution, admission.project).receipt;
  const transport = new State(join(h.plan.pilotDirectory, 'transport'));
  transport.projectAssignedTask(admission.store.request(accepted.request.id)!, 'pilot', h.plan.scope.projects.pilot!, 'interrupted');
  assert.equal(transport.drainStatus().outbox, 0); transport.close(); admission.store.maintenance.quiesce(); admission.close();
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  await assert.rejects(rollbackHandoff(h.plan), /withdrawal notice.*projected/);
  const pending = new State(join(h.plan.pilotDirectory, 'transport'));
  pending.projectWithdrawalNotice(receipt.origin, command, accepted.request.execution); pending.close();
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  const acknowledged = new State(join(h.plan.pilotDirectory, 'transport'));
  const notice = acknowledged.pending().find(row => row.replyTo === command.id)!; assert.ok(notice);
  acknowledged.delivered(notice.id, 'withdrawal-ack');
  const query = { ...message, id: 'task-query-before-rollback', text: '/task ' + accepted.request.execution };
  const card = { id: randomUUID(), execution: accepted.request.execution, tenant: message.tenant, user: message.user, chat: message.chat, text: 'Historical withdrawn fixture task' };
  acknowledged.transaction(() => { acknowledged.remember(query); acknowledged.send(message.chat, card.text, { taskId: card.execution, taskView: card, replyTo: query.id }); });
  const cardDelivery = acknowledged.pending().find(row => row.taskView)!; acknowledged.delivered(cardDelivery.id, 'task-card-before-rollback');
  const refresh = { ...message, id: 'task-refresh/fixture-before-rollback', text: '/task' };
  acknowledged.transaction(() => { acknowledged.remember(refresh); acknowledged.refreshTaskView(card, 'task-card-before-rollback'); }); acknowledged.close();
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  const cardTransport = new State(join(h.plan.pilotDirectory, 'transport'));
  cardTransport.delivered(cardTransport.pending().find(row => row.taskView && row.updateMessage)!.id); cardTransport.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const restored = new State(h.plan.legacyDirectory);
  assert.equal(restored.remember(command), false); assert.equal(restored.remember(message), false);
  assert.equal(restored.drainStatus().queued, 0);
  assert.equal(restored.remember(query), false); assert.equal(restored.remember(refresh), false);
  assert.equal(restored.referencedTask('task-card-before-rollback', JSON.stringify([message.tenant, message.user, message.chat])), card.execution); restored.close();
  assert.equal(read(join(h.plan.legacyDirectory, 'bridge.db'), db => (db.prepare('SELECT status FROM tasks WHERE id=?').get(accepted.request.execution) as { status: string }).status), 'interrupted');
  const operation = JSON.parse(readFileSync(join(h.plan.bundleDirectory, 'handoff-operation.json'), 'utf8'));
  const retained = read(join(h.plan.bundleDirectory, operation.archive, 'handoff.db'), db => db.prepare('SELECT * FROM withdrawals').all());
  assert.deepEqual(retained.map(row => ({ ...row })), [receipt]);
  const verification = read(join(h.plan.bundleDirectory, operation.archive, 'handoff.db'), db => db.prepare('SELECT profile,phase,observation FROM verifications').get());
  assert.deepEqual({ ...verification }, { profile: 'withdrawn-fixture', phase: 'skipped', observation: null });
  const retainedCard = read(join(h.plan.bundleDirectory, operation.archive, 'transport.db'), db => db.prepare('SELECT id,execution,message FROM task_views').get());
  assert.deepEqual({ ...retainedCard }, { id: card.id, execution: card.execution, message: 'task-card-before-rollback' });
});

test('rollback waits for a committed quoted reply receipt after a gateway crash and recovery projects it once', async t => {
  const h = await fixture(t); await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  const codex = new ManagedFake();
  const native = new NativeExecutions(admission, h.plan.config, () => codex);
  const delivered: string[] = [];
  const gateway = () => new PilotInteractions(admission, h.plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) },
    native, { send: async (_chat, _text, id, options) => {
      if (options?.replyTo) delivered.push(options.replyTo);
      return 'delivered-' + id;
    } }, { addReaction: async () => 'reaction', findReaction: async () => undefined, removeReaction: async () => {} });
  let interactions = gateway();
  admission.store.maintenance.resume();
  const original = { ...h.message, chatType: 'p2p' as const, id: 'pilot-quoted-task', text: 'Read the task' };
  const accepted = interactions.receive(original); assert.ok('request' in accepted);
  admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected reservation');
  const running = native.run(grant.permit);
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  const liveReply = { ...original, id: 'quoted-live-reply-before-rollback', text: 'Also check CI', parentId: original.id };
  assert.equal(interactions.receive(liveReply).status, 'task-reply');
  codex.complete('retained-native-thread', 'turn-1');
  await running;
  // Deliver the original result, then simulate stopping before the gateway reconciles the live reply.
  await interactions.transport.sync();
  await interactions.transport.flush();
  await interactions.transport.close();
  assert.equal(admission.store.control(liveReply)?.status, 'received');
  admission.store.maintenance.quiesce();
  const reply = { ...original, id: 'quoted-reply-before-rollback', text: 'What about CI?', parentId: original.id };
  // Commit only the ingress transaction to exercise the crash before transport projection.
  assert.equal(admission.store.acceptTaskReply(reply, admission.project)?.status, 'task-reply');
  const transport = new State(join(h.plan.pilotDirectory, 'transport'));
  try {
    assert.equal(transport.drainStatus().outbox, 0);
    const status = await pilotMaintenance(admission, native, transport, { command: 'status' });
    assert.equal(status.outbox, 1);
    assert.equal(status.controls, 1);
    assert.equal(status.guards, 0);
  } finally { transport.close(); }
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  admission.store.finishTaskReplies();
  await assert.rejects(rollbackHandoff(h.plan), /task reply notice.*projected/);
  interactions = gateway();
  await interactions.recover();
  assert.equal(interactions.receive(reply).status, 'ignored');
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  for (let i = 0; i < 5; i++) await interactions.flush();
  assert.equal(delivered.filter(id => id === reply.id).length, 1);
  assert.equal(delivered.filter(id => id === liveReply.id).length, 1);

  admission.store.maintenance.resume();
  const followupMessage = { ...reply, id: 'queued-quoted-reply-before-thread-change' };
  assert.equal(interactions.receive(followupMessage).status, 'task-reply');
  const followup = admission.store.requests().at(-1)!;
  admission.store.routed(followup.id, true);
  await interactions.flush();
  assert.equal(delivered.filter(id => id === followupMessage.id).length, 1);
  await interactions.close();
  const fixtureDb = new DatabaseSync(join(h.plan.pilotDirectory, 'handoff.db'));
  try { fixtureDb.prepare('UPDATE conversations SET thread=? WHERE id=?').run('fixture-replacement-thread', followup.conversation); }
  finally { fixtureDb.close(); }
  assert.equal(admission.store.reserve(followup.id, 2).kind, 'blocked');
  admission.store.maintenance.quiesce();
  const interruptedGateway = gateway();
  const projected = interruptedGateway.transport.state;
  try {
    projected.projectAssignedTask(admission.store.request(followup.id)!, 'pilot', admission.directory, 'unknown');
    await interruptedGateway.transport.flush();
    assert.equal(projected.drainStatus().outbox, 0);
    assert.equal(projected.drainStatus().reactions, 0);
    assert.equal((await pilotMaintenance(admission, native, projected, { command: 'status' })).outbox, 1);
  } finally { projected.close(); }
  await assert.rejects(rollbackHandoff(h.plan), /task reply notice.*projected/);
  interactions = gateway();
  await interactions.recover();
  await assert.rejects(rollbackHandoff(h.plan), /drained/);
  for (let i = 0; i < 5; i++) await interactions.flush();
  assert.equal(delivered.filter(id => id === followupMessage.id).length, 2);
  assert.equal(admission.store.execution(followup.execution), undefined);
  await interactions.close();
  admission.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const restored = new State(h.plan.legacyDirectory);
  assert.equal(restored.remember(reply), false);
  assert.equal(restored.remember(followupMessage), false);
  restored.close();
});

test('closed rollback retains named work and restores the legacy default thread', async t => {
  const h = await fixture(t);
  await stageHandoff(h.plan);
  const admission = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  admission.store.maintenance.resume();
  const codex = new ManagedFake(), native = new NativeExecutions(admission, h.plan.config, () => codex);
  const interactions = new PilotInteractions(admission, h.plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) }, native,
    { send: async (_chat, _text, id) => 'matter-answer-' + id },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  const named = { ...h.message, chatType: 'p2p' as const, id: 'named-command', text: '/matter-new Release' };
  interactions.receive(named);
  const work = interactions.receive({ ...named, id: 'named-task', text: 'Check release' });
  assert.ok('request' in work);
  admission.store.rememberEvent(work.request.id, 1);
  admission.store.routed(work.request.id, true);
  const grant = admission.store.reserve(work.request.id, 1);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected named assignment');
  const running = native.run(grant.permit);
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  codex.complete('thread-1', 'turn-2'); await running;
  for (let i = 0; i < 6; i++) await interactions.flush();
  const unprojected = { ...named, id: 'unprojected-command' };
  admission.store.matters.retainNotice(unprojected, () => ({ text: 'Retained response' }));
  admission.store.maintenance.quiesce();
  await interactions.close(); admission.close();
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  await assert.rejects(rollbackHandoff(h.plan), /matter response has not been projected/);
  assert.equal(readFence(h.plan.legacyDirectory)!.role, 'pilot');
  const reopened = new PilotAdmission(h.plan.pilotDirectory, h.plan.scope);
  const recovery = new PilotInteractions(reopened, h.plan.config, { flush: async () => {}, diagnose: async () => ({ status: 'unavailable' }) },
    new NativeExecutions(reopened, h.plan.config, () => new ManagedFake()),
    { send: async (_chat, _text, id) => 'matter-answer-' + id },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  await recovery.recover();
  for (let i = 0; i < 6; i++) await recovery.flush();
  await recovery.close(); reopened.close();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const restored = new State(h.plan.legacyDirectory);
  try {
    assert.equal(restored.selected(h.message)?.thread, 'retained-native-thread');
    assert.equal(restored.session(work.request.conversation).thread, 'thread-1');
    assert.equal(restored.remember(named), false);
  } finally { restored.close(); }
});
