import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { State } from '../src/state.js';
import { Bridge } from '../src/bridge.js';
import { PilotAdmission } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
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
  bridge.receive(actor('/补充 Keep the existing task constrained'));
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
  const interactions = new PilotInteractions(admission, h.plan.config, { flush: async () => {} }, native,
    { send: async (_chat, _text, id) => { sent.push(id); return 'pilot-answer-' + id; } },
    { addReaction: async () => 'reaction', findReaction: async () => 'reaction', removeReaction: async () => {} });
  const message = { ...h.message, id: 'pilot-source', text: 'Continue native work' };
  const accepted = interactions.receive(message); assert.ok('request' in accepted);
  admission.store.rememberEvent(accepted.request.id, 1); admission.store.routed(accepted.request.id, true);
  const grant = admission.store.reserve(accepted.request.id, 1); assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const running = native.run(grant.permit);
  await until(() => codex.calls.some(call => call.method === 'turn/start'));
  assert.equal(codex.calls.find(call => call.method === 'thread/resume')!.params.threadId, 'retained-native-thread');
  const controlMessage = { ...message, id: 'pilot-control', text: '/补充 Keep this constraint' };
  interactions.receive(controlMessage); await interactions.flush();
  codex.complete('retained-native-thread', 'turn-1'); await running;
  for (let i = 0; i < 6; i++) await interactions.flush();
  admission.store.maintenance.quiesce();
  await interactions.close(); admission.close();
  const lease = await acquireRoot(h.plan.legacyDirectory, 'pilot', h.plan.pilotDirectory);
  const controller = await openRuntimeControl(lease, () => ({})); await controller.close(true); await lease.release();
  assert.equal((await rollbackHandoff(h.plan)).window, 'after-traffic');
  const restored = new State(h.plan.legacyDirectory);
  assert.equal(restored.remember(message), false);
  assert.equal(restored.remember(controlMessage), false);
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
  const interactions = new PilotInteractions(admission, plan.config, { flush: async () => {} }, native,
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
  const interactions = new PilotInteractions(admission, plan.config, { flush: async () => {} }, native,
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
