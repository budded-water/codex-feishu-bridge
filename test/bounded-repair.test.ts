import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { FakeCodex, message, until } from './helpers.js';
import type { Config } from '../src/config.js';
import type { DeliveryOptions } from '../src/types.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { fingerprint, verificationProfiles } from '../src/handoff/verification-profile.js';
import { repairEligible } from '../src/handoff/repair-evidence.js';
import { runVerification } from '../src/handoff/verification-runner.js';
import { archiveNativeEvidence } from '../src/handoff/migration.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  constructor(private mode = 'normal') { super(); }
  generation = randomUUID();
  async start() { this.ready = true; }
  async close() { this.exit(); }
  async request<T = unknown>(method: string, params: unknown): Promise<T> {
    const result = await super.request<T>(method, params);
    if (method === 'turn/start' && this.mode === 'lost-start') throw Error('Accepted turn start acknowledgement lost');
    return result;
  }
}

function setup(t: TestContext, mode = 'normal', budget = 30_000, outerBudget = 600_000) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bounded-repair-'))), project = join(root, 'project'), engine = join(root, 'engine'), workspace = join(root, 'workspace');
  for (const path of [project, workspace, join(engine, 'dist'), join(project, 'ui-eval/integrations')]) mkdirSync(path, { recursive: true });
  writeFileSync(join(engine, 'package.json'), '{"type":"module"}'); writeFileSync(join(engine, '.gitignore'), 'revision\n');
  copyFileSync(new URL('./fixtures/repair-engine.mjs', import.meta.url), join(engine, 'dist/cli.js'));
  writeFileSync(join(engine, 'dist/index.js'), `import {createHash} from 'node:crypto';
    export const canonicalDigest=v=>'sha256:'+createHash('sha256').update(JSON.stringify(v)).digest('hex');
    export function assertIntegrationResult(v){ if(v.kind!=='IntegrationResult'||!v.stages.length)throw Error('invalid'); }
    const envelope=v=>{ if(v.metadata.specDigest!==canonicalDigest(v.spec))throw Error('changed spec');return v; };
    export const validateCaptureBundle=envelope,validateEvaluationPolicy=envelope;
    export const validateEvaluationReport=v=>{if(!v.spec?.inputs)throw Error('invalid');return v;};`);
  writeFileSync(join(project, 'page.txt'), 'broken'); writeFileSync(join(project, 'mode.txt'), mode);
  writeFileSync(join(project, '.gitignore'), '.ui-eval/\n.ready\n.spawns\n');
  writeFileSync(join(project, 'ui-eval/project.json'), '{"projectId":"fixture"}');
  writeFileSync(join(project, 'ui-eval/engine.json'), '{}');
  writeFileSync(join(project, 'ui-eval/integrations/smoke.json'), '{"id":"smoke","projectId":"fixture","adapter":"web"}');
  const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  for (const cwd of [project, engine]) { git(cwd, ['init', '-q']); git(cwd, ['add', '.']); git(cwd, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'fixture']); }
  const revision = git(engine, ['rev-parse', 'HEAD']); writeFileSync(join(engine, 'revision'), revision);
  const profiles = verificationProfiles({ fixture: { projectRoot: project, projectId: 'fixture', suite: 'smoke', engineRoot: engine,
    engineRevision: revision, cliHash: fingerprint(readFileSync(join(engine, 'dist/cli.js'))), libraryHash: fingerprint(readFileSync(join(engine, 'dist/index.js'))), timeoutMs: 10_000,
    policyFiles: Object.fromEntries(['ui-eval/project.json', 'ui-eval/engine.json', 'ui-eval/integrations/smoke.json'].map(p => [p, fingerprint(readFileSync(join(project, p)))])),
    repair: { scenarios: ['home'], timeoutMs: budget } } });
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: workspace }, pilot: 'pilot',
    hubInstance: 'fixture-hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { accessMode: 'allowlist', allowedUsers: [scope.operator], allowedTenant: scope.tenant, enableGroups: false,
    groupContextMessages: 0, groupContextImages: 0, approvalUsers: [scope.operator], approvalChat: null, approvalTimeoutSeconds: 300,
    codexExecutable: 'codex', stateDirectory: join(root, 'state'), projects: scope.projects, projectRouting: 'workspace' };
  const admission = new PilotAdmission(config.stateDirectory, scope, 'workspace'), codexes: ManagedFake[] = [];
  const native = new NativeExecutions(admission, config, () => { const c = new ManagedFake(mode); codexes.push(c); return c; }, profiles, { outerDeadline: Date.now() + outerBudget });
  const sent: { text: string; id: string; replyTo?: string; options?: DeliveryOptions }[] = [];
  const cardUpdates: { message: string; view: string }[] = [];
  const sender = { send: async (_chat: string, text: string, id: string, options?: DeliveryOptions) => { sent.push({ text, id, replyTo: options?.replyTo, options }); return id; },
    updateApproval: async (message: string, _approval: unknown, view: string) => { cardUpdates.push({ message, view }); } };
  const reactions = { addReaction: async () => 'reaction', findReaction: async () => undefined, removeReaction: async () => {} };
  let interactions = new PilotInteractions(admission, config, { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, [], undefined, profiles);
  let pending: Promise<unknown> | undefined;
  const admit = (text = '/verify-repair fixture Fix the title') => {
    const trigger = message(text, { chatType: 'p2p' }), result = interactions.receive(trigger); assert.ok('request' in result);
    const grant = admission.store.reserve(result.request.id, 1); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') throw Error('no grant');
    return { trigger, request: result.request, permit: grant.permit };
  };
  const start = async (text?: string) => { const task = admit(text); const running = native.run(task.permit); pending = running; return { ...task, running }; };
  const turn = async (index: number) => {
    await until(() => Boolean(codexes[index]?.calls.some(c => c.method === 'turn/start')));
    const codex = codexes[index]!, call = codex.calls.find(c => c.method === 'turn/start')!;
    const target = await native.inspect(admission.store.requests()[0]!.execution);
    return { codex, call, thread: String(call.params.threadId), turn: String(target.turn), generation: codex.generation };
  };
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config,
    { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, [], undefined, profiles); await interactions.start(); };
  t.after(async () => { await native.stop(); await pending?.catch(() => {}); await interactions.close(); admission.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, project, profiles, config, scope, admission, native, codexes, sent, cardUpdates, admit, start, turn, restart, get interactions() { return interactions; } };
}

test('bounded repair continues the verified conversation with immutable journals and final-only durable replies', async t => {
  const h = setup(t), task = await h.start(), first = await h.turn(0);
  first.codex.complete(first.thread, first.turn, 'completed', 'FIRST_DRAFT');
  const second = await h.turn(1), goal = h.admission.store.repairs.get(task.request.execution)!;
  assert.equal(goal.attempts.length, 2); assert.equal(second.thread, first.thread); assert.notEqual(second.generation, first.generation);
  assert.ok(second.codex.calls.some(c => c.method === 'thread/resume'));
  const other = new PilotAdmission(h.config.stateDirectory, h.scope, 'workspace');
  const queued = other.receive(message('Other task', { chatType: 'p2p' })); assert.ok('request' in queued);
  assert.equal(other.store.reserve(queued.request.id, 2).kind, 'busy');
  assert.throws(() => other.store.repairs.launch(task.permit, 'native'), /credit/);
  other.store.withdraw(message('/withdraw ' + queued.request.execution, { chatType: 'p2p' }), queued.request.execution, other.project); other.close();
  const firstPath = join(h.config.stateDirectory, 'executions', task.request.execution, 'attempts', goal.attempts[0]!.id, 'bridge.db');
  const original = readFileSync(firstPath);
  const secondPath = join(h.config.stateDirectory, 'executions', task.request.execution, 'attempts', goal.attempts[1]!.id, 'bridge.db');
  const db = new DatabaseSync(secondPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM seen').get()!.n, 0, 'continuation does not forge platform ingress');
  assert.ok(db.prepare('SELECT authority FROM continuation_origin').get()); db.close();
  await h.interactions.flush(); assert.equal(h.sent.some(x => x.text.includes('FIRST_DRAFT')), false);
  writeFileSync(join(h.project, 'page.txt'), 'fixed'); second.codex.complete(second.thread, second.turn, 'completed', 'FINAL_REPAIRED');
  const report = await task.running; assert.equal(report.version, 2);
  for (let i = 0; i < 4; i++) await h.interactions.flush();
  assert.equal(h.admission.store.repairs.get(task.request.execution)!.status, 'pass');
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '2'); assert.equal(h.admission.store.unsettled().length, 0);
  assert.deepEqual(readFileSync(firstPath), original);
  assert.equal(h.sent.filter(x => x.text === 'FINAL_REPAIRED').length, 1); assert.equal(h.sent.some(x => x.text.includes('FIRST_DRAFT')), false);
  h.interactions.receive(task.trigger); h.interactions.receive(message('/verification ' + task.request.execution, { chatType: 'p2p' }));
  await h.restart(); for (let i = 0; i < 3; i++) await h.interactions.flush();
  assert.equal((await h.native.run(task.permit)).checkpoint, report.checkpoint); assert.equal(h.codexes.length, 2);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '2'); assert.deepEqual(readFileSync(firstPath), original);
  assert.equal(h.sent.filter(x => x.text === 'FINAL_REPAIRED').length, 1);
  const archive = join(h.root, 'archive'); mkdirSync(archive);
  copyFileSync(join(h.config.stateDirectory, 'handoff.db'), join(archive, 'handoff.db'));
  const archived = archiveNativeEvidence(h.config.stateDirectory, archive);
  assert.ok(archived[task.request.execution + '/repair-manifest.json']);
  for (const a of goal.attempts) assert.deepEqual(readFileSync(join(archive, task.request.execution, 'attempts', a.id, 'bridge.db')),
    readFileSync(join(h.config.stateDirectory, 'executions', task.request.execution, 'attempts', a.id, 'bridge.db')));
  const foreign = join(h.config.stateDirectory, 'executions', task.request.execution, 'unexpected.txt'); writeFileSync(foreign, 'foreign');
  const rejected = join(h.root, 'rejected-archive'); mkdirSync(rejected); copyFileSync(join(h.config.stateDirectory, 'handoff.db'), join(rejected, 'handoff.db'));
  assert.throws(() => archiveNativeEvidence(h.config.stateDirectory, rejected), /Unexpected/);
});

test('repair is opt-in and already-pass, mixed failures and exhausted credit never create extra turns', async t => {
  const boundary = setup(t);
  assert.equal(boundary.admission.receiveVerification(message('Ordinary task', { chatType: 'p2p' }), 'task',
    { profile: 'fixture', definition: boundary.profiles.fixture!, repair: true }).status, 'rejected');
  assert.equal(boundary.interactions.receive(message('/verify-repair fixture task', { chatType: 'p2p', user: 'ou_other' })).status, 'rejected');
  for (const variant of ['pass', 'mixed', 'twice', 'ordinary']) {
    const h = setup(t, variant === 'mixed' ? 'mixed' : 'normal');
    if (variant === 'pass') writeFileSync(join(h.project, 'page.txt'), 'fixed');
    const task = await h.start(variant === 'ordinary' ? '/verify fixture Fix title' : undefined), first = await h.turn(0);
    first.codex.complete(first.thread, first.turn);
    if (variant === 'twice') { const second = await h.turn(1); second.codex.complete(second.thread, second.turn); }
    await task.running;
    assert.equal(h.codexes.length, variant === 'twice' ? 2 : 1, variant);
    assert.equal(h.admission.store.repairs.get(task.request.execution)?.status, variant === 'ordinary' ? undefined : variant === 'pass' ? 'pass' : variant === 'twice' ? 'fail' : 'ineligible');
  }
});

test('actual source, policy and nested report changes cannot authorize a repair', async t => {
  for (const mutation of ['source', 'policy', 'capture', 'report', 'fixture-fault']) {
    const h = setup(t, mutation === 'fixture-fault' ? mutation : 'normal'), p = h.profiles.fixture!;
    const observation = await runVerification(p, new AbortController().signal);
    assert.equal(await repairEligible(p, observation), mutation !== 'fixture-fault');
    if (mutation === 'source') writeFileSync(join(h.project, 'page.txt'), 'changed');
    if (mutation === 'policy') writeFileSync(join(h.project, 'ui-eval/project.json'), '{}');
    if (mutation === 'capture' || mutation === 'report') {
      const result = JSON.parse(readFileSync(observation.integration!.summaryPath, 'utf8'));
      const path = join(h.project, result.stages.at(-1).reports[0].reportPath);
      writeFileSync(mutation === 'report' ? path : join(path, '..', 'capture.json'), '{}');
    }
    assert.equal(await repairEligible(p, observation), false, mutation);
  }
});

test('owner stop before startup and during either native round prohibits all later work', async t => {
  for (const phase of ['before', 'first', 'second']) {
    const h = setup(t), task = await h.start();
    if (phase !== 'before') {
      const first = await h.turn(0);
      if (phase === 'second') { first.codex.complete(first.thread, first.turn); await h.turn(1); }
    }
    const stop = message('/stop', { chatType: 'p2p' });
    assert.equal(h.interactions.receive(stop).status, 'repair-control');
    h.interactions.receive(stop);
    await task.running; await h.interactions.flush();
    assert.equal(h.admission.store.repairs.get(task.request.execution)!.status, 'stopped');
    assert.equal(h.codexes.length, phase === 'before' ? 0 : phase === 'first' ? 1 : 2);
    assert.equal(existsSync(join(h.project, '.spawns')), phase === 'second');
    assert.equal(h.admission.store.unsettled().length, 0);
  }
});

test('finite work budget interrupts approval/native waiting rather than scheduling another attempt', async t => {
  const h = setup(t, 'normal', 1000), task = await h.start(); await h.turn(0); await task.running;
  const goal = h.admission.store.repairs.get(task.request.execution)!;
  assert.equal(goal.status, 'incomplete'); assert.equal(goal.attempts.length, 1);
  assert.equal(existsSync(join(h.project, '.spawns')), false); assert.equal(h.admission.store.unsettled().length, 0);
});

test('unconfirmed verifier cleanup remains guarded and cannot use native-only Feishu recovery', async t => {
  const h = setup(t, 'hold'), task = await h.start(), first = await h.turn(0);
  first.codex.complete(first.thread, first.turn);
  await until(() => existsSync(join(h.project, '.ready')));
  h.interactions.receive(message('/stop', { chatType: 'p2p' }));
  await task.running;
  assert.equal(h.admission.store.repairs.get(task.request.execution)!.status, 'unknown');
  assert.equal(h.admission.store.unsettled()[0]!.status, 'unknown');
  await assert.rejects(h.native.recoveryCheckpoint(task.request.execution), /local/);
  await h.native.recover(); assert.equal(h.codexes.length, 1);
});

test('current native approvals work and prior-attempt approvals and snapshots cannot affect repair', async t => {
  const h = setup(t), task = await h.start(), first = await h.turn(0);
  first.codex.ask('approval-one', 'item/commandExecution/requestApproval', { threadId: first.thread, turnId: first.turn, command: 'echo first' });
  const prompt1 = (await h.native.projection(task.request.execution)).prompts[0]!;
  const approve = message('/approve ' + prompt1.id.slice(0, 8), { chatType: 'p2p' });
  h.interactions.receive(approve); await h.interactions.flush();
  assert.equal(first.codex.replies.length, 1);
  first.codex.complete(first.thread, first.turn);
  const second = await h.turn(1);
  const goal = h.admission.store.repairs.get(task.request.execution)!;
  assert.throws(() => h.admission.store.nativeSnapshot(task.permit, { thread: first.thread, turn: first.turn, generation: first.generation }, goal.attempts[0]!.id), /Stale/);
  second.codex.ask('approval-two', 'item/commandExecution/requestApproval', { threadId: second.thread, turnId: second.turn, command: 'echo second' });
  const p = await h.native.projection(task.request.execution), prompt2 = p.prompts.find(x => x.id !== prompt1.id)!;
  h.interactions.receive(message('/approve ' + prompt1.id.slice(0, 8), { chatType: 'p2p' })); await h.interactions.flush();
  assert.equal(second.codex.replies.length, 0);
  const original = h.native.relay.bind(h.native);
  h.native.relay = async (...args) => { await original(...args); throw Error('Lost acknowledgement'); };
  const decision = message('/approve ' + prompt2.id.slice(0, 8), { chatType: 'p2p' });
  h.interactions.receive(decision); await h.interactions.flush(); await h.restart(); await h.interactions.flush();
  assert.equal(second.codex.replies.length, 1); assert.equal(h.admission.store.control(decision)!.status, 'sent');
  writeFileSync(join(h.project, 'page.txt'), 'fixed'); second.codex.complete(second.thread, second.turn); await task.running;
});

test('insufficient actual Worker budget refuses native dispatch and still produces a terminal handoff', async t => {
  const h = setup(t, 'normal', 30_000, 1000), task = await h.start(); await task.running;
  for (let i = 0; i < 3; i++) await h.interactions.flush();
  assert.equal(h.codexes.length, 0); assert.equal(h.admission.store.repairs.get(task.request.execution)!.status, 'incomplete');
  assert.ok(h.sent.some(d => d.text.includes('修复闭环 · 未完成'))); assert.equal(h.admission.store.unsettled().length, 0);
});

test('actual owner loss in either native attempt or verifier retains its guard and cannot replay after restart', async t => {
  for (const phase of ['first', 'second', 'verifier']) {
    const round = phase === 'second' ? 2 : 1;
    const h = setup(t, phase === 'verifier' ? 'hold' : 'normal'), task = h.admit(), packet = join(h.root, 'owner.json');
    writeFileSync(packet, JSON.stringify({ config: h.config, scope: h.scope, profiles: h.profiles, permit: task.permit, round, phase }));
    const child = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/repair-owner.ts', packet], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { error += String(data); });
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    try {
      await until(() => { if (child.exitCode !== null) throw Error(error); return output.includes('READY'); });
      child.kill('SIGKILL'); await exited;
      if (phase === 'verifier') {
        const pid = Number(readFileSync(join(h.project, '.ready'), 'utf8'));
        assert.doesNotThrow(() => process.kill(pid, 0), 'Uncertain child settlement must not be inferred from owner exit');
        process.kill(pid, 'SIGTERM');
      }
      await h.native.recover();
      assert.equal(h.admission.store.unsettled()[0]!.status, 'unknown');
      const before = h.admission.store.repairs.binding(task.request.execution);
      await h.restart(); await assert.rejects(h.native.run(task.permit));
      h.interactions.receive(task.trigger); const view = h.interactions.receive(message('/status', { chatType: 'p2p' }));
      for (let i = 0; i < 3; i++) await h.interactions.flush();
      assert.equal(h.codexes.length, 0); assert.equal(h.admission.store.repairs.binding(task.request.execution), before);
      assert.equal(h.admission.store.repairs.get(task.request.execution)!.attempts.length, round);
      assert.ok(h.sent.some(d => d.text.includes('阶段是保留记录')), JSON.stringify({ view, sent: h.sent.map(d => d.text), pending: h.interactions.transport.state.pending() }));
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
  }
});

test('stop decision survives a lost projection and replayed message without losing or duplicating its receipt', async t => {
  const h = setup(t), task = await h.start(); await h.turn(0);
  const stop = message('/stop', { chatType: 'p2p' });
  const project = h.interactions.transport.state.projectControlNotice;
  h.interactions.transport.state.projectControlNotice = () => { throw Error('Projection unavailable after commit'); };
  assert.throws(() => h.interactions.receive(stop), /Projection/);
  h.interactions.transport.state.projectControlNotice = project;
  assert.equal(h.admission.store.repairs.get(task.request.execution)!.stop, true);
  assert.equal(h.admission.store.control(stop)!.status, 'stopping');
  await task.running; await h.restart();
  h.interactions.receive(stop); for (let i = 0; i < 4; i++) await h.interactions.flush();
  assert.equal(h.codexes.length, 1); assert.equal(h.sent.filter(d => d.text.includes('已记录停止整个修复任务')).length, 1);
});

test('lost native start acknowledgement retains unknown goal protection without invoking verification or repair', async t => {
  const h = setup(t, 'lost-start'), task = await h.start(); await task.running;
  const goal = h.admission.store.repairs.get(task.request.execution)!;
  assert.equal(goal.status, 'unknown'); assert.equal(goal.attempts.length, 1);
  assert.equal(goal.attempts[0]!.native!.outcome.status, 'unknown');
  assert.equal(existsSync(join(h.project, '.spawns')), false);
  await h.native.recover(); assert.equal(h.codexes.length, 1); assert.equal(h.admission.store.unsettled()[0]!.status, 'unknown');
});

test('repair approval cards bind the active attempt and reject an old card after continuation', async t => {
  const h = setup(t), task = await h.start(), first = await h.turn(0);
  first.codex.ask('card-one', 'item/commandExecution/requestApproval', { threadId: first.thread, turnId: first.turn, command: 'echo first-card' });
  for (let i = 0; i < 3; i++) await h.interactions.flush();
  const card1 = h.sent.find(d => d.options?.approval)!; assert.ok(card1);
  const click = (card: typeof card1) => ({ event: randomUUID(), tenant: h.scope.tenant, user: h.scope.operator, chat: h.scope.chat,
    message: card.id, id: card.options!.approval!.id, decision: 'approve' as const });
  assert.equal(h.interactions.cardAction(click(card1)), 'accepted'); await h.interactions.flush(); assert.equal(first.codex.replies.length, 1);
  first.codex.complete(first.thread, first.turn); const second = await h.turn(1);
  await h.interactions.flush(); assert.equal(h.interactions.cardAction(click(card1)), 'rejected');
  second.codex.ask('card-two', 'item/commandExecution/requestApproval', { threadId: second.thread, turnId: second.turn, command: 'echo second-card' });
  for (let i = 0; i < 3; i++) await h.interactions.flush();
  const card2 = h.sent.find(d => d.options?.approval && d.id !== card1.id)!; assert.ok(card2);
  assert.equal(h.interactions.cardAction(click(card2)), 'accepted'); await h.interactions.flush(); assert.equal(second.codex.replies.length, 1);
  writeFileSync(join(h.project, 'page.txt'), 'fixed'); second.codex.complete(second.thread, second.turn); await task.running;
  for (let i = 0; i < 3; i++) await h.interactions.flush();
  assert.deepEqual(h.cardUpdates.map(u => u.view), ['approved', 'approved']);
});
