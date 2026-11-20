import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { verificationProfiles, fingerprint, profileDigest, type VerificationProfile } from '../src/handoff/verification-profile.js';
import { runVerification } from '../src/handoff/verification-runner.js';
import { verificationApplicability } from '../src/handoff/verification-view.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { PilotInteractions } from '../src/handoff/interactions.js';
import { executionReceipt } from '../src/handoff/receipt.js';
import { FakeCodex, until, message } from './helpers.js';
import type { Config } from '../src/config.js';

function fixture(t: TestContext, mode = 'pass', cleanup = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'verification-')));
  const project = join(root, 'project'), engine = join(root, 'engine');
  mkdirSync(project); mkdirSync(join(engine, 'dist'), { recursive: true });
  writeFileSync(join(engine, 'package.json'), '{"type":"module"}');
  writeFileSync(join(engine, '.gitignore'), 'revision\n');
  copyFileSync(new URL('./fixtures/verification-cli.mjs', import.meta.url), join(engine, 'dist/cli.js'));
  writeFileSync(join(engine, 'dist/index.js'), `import { createHash } from 'node:crypto';
  export const canonicalDigest = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
  export function assertIntegrationResult(v) {
    if(v.kind!=='IntegrationResult'||!['pass','fail','needs-review','inconclusive','interrupted'].includes(v.status)||!Array.isArray(v.stages)) throw Error('invalid fixture result');
  }`);
  writeFileSync(join(project, 'mode.json'), JSON.stringify({ mode }));
  mkdirSync(join(project, 'ui-eval/integrations'), { recursive: true });
  writeFileSync(join(project, 'ui-eval/project.json'), '{"projectId":"fixture"}');
  writeFileSync(join(project, 'ui-eval/engine.json'), '{"fixture":true}');
  writeFileSync(join(project, 'ui-eval/integrations/smoke.json'), '{"id":"smoke","projectId":"fixture","adapter":"web"}');
  writeFileSync(join(project, '.gitignore'), '.ui-eval/\n.ready\n.spawns\n.environment.json\n');
  const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  for (const directory of [engine, project]) {
    git(directory, ['init', '-q']); git(directory, ['add', '.']);
    git(directory, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'fixture']);
  }
  const revision = git(engine, ['rev-parse', 'HEAD']); writeFileSync(join(engine, 'revision'), revision);
  const profile: VerificationProfile = { projectRoot: project, projectId: 'fixture', suite: 'smoke', engineRoot: engine,
    engineRevision: revision, cliHash: fingerprint(readFileSync(join(engine, 'dist/cli.js'))),
    libraryHash: fingerprint(readFileSync(join(engine, 'dist/index.js'))), timeoutMs: 5000,
    policyFiles: Object.fromEntries(['ui-eval/project.json', 'ui-eval/engine.json', 'ui-eval/integrations/smoke.json']
      .map(path => [path, fingerprint(readFileSync(join(project, path)))])) };
  if (cleanup) t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, project, engine, profile, git, mode: (value: string) => writeFileSync(join(project, 'mode.json'), JSON.stringify({ mode: value })) };
}

test('real pinned child outcomes retain separate status and paired report bytes', async t => {
  for (const status of ['pass', 'fail', 'needs-review', 'inconclusive']) {
    const f = fixture(t, status), result = await runVerification(f.profile, new AbortController().signal);
    assert.equal(result.status, status); assert.equal(result.cleanupSettled, true);
    assert.equal(result.integration!.jsonHash, fingerprint(readFileSync(result.integration!.summaryPath)));
    assert.equal(result.integration!.htmlHash, fingerprint(readFileSync(result.integration!.htmlPath)));
    assert.equal(readFileSync(join(f.project, '.spawns'), 'utf8'), '1');
  }
});

test('a digest-only Web summary binds the commit from its verified adapter report', async t => {
  const f = fixture(t, 'legacy-web');
  const result = await runVerification(f.profile, new AbortController().signal);
  assert.equal(result.status, 'pass');
  assert.equal(result.gitHead, f.git(f.project, ['rev-parse', 'HEAD']));
  assert.deepEqual(result.integration?.source, { commitSha: result.gitHead, dirtyTree: false });
  assert.equal(JSON.parse(readFileSync(result.integration!.summaryPath, 'utf8')).source, undefined);

  const mismatch = fixture(t, 'legacy-web-mismatch');
  const rejected = await runVerification(mismatch.profile, new AbortController().signal);
  assert.equal(rejected.status, 'unverified');
  assert.equal(rejected.integration, undefined);
});

test('unconfirmed child evidence never becomes pass or settled cleanup', async t => {
  for (const mode of ['missing-html', 'mismatch', 'foreign', 'linked', 'old', 'cleanup', 'wrong-exit']) {
    const f = fixture(t, mode);
    if (mode === 'old') mkdirSync(join(f.project, '.ui-eval/integration/11111111-1111-4111-8111-111111111111'), { recursive: true });
    const result = await runVerification(f.profile, new AbortController().signal);
    assert.equal(result.cleanupSettled, false, mode); assert.notEqual(result.status, 'pass', mode);
  }
});

test('prelaunch engine/build drift does not execute a child; profile boundary rejects unknown executable input', async t => {
  const f = fixture(t);
  assert.throws(() => verificationProfiles({ smoke: { ...f.profile, command: 'other' } }));
  assert.throws(() => verificationProfiles([]));
  assert.throws(() => verificationProfiles({ smoke: { ...f.profile, policyFiles: {} } }));
  assert.throws(() => verificationProfiles({ smoke: { ...f.profile, policyFiles: { ...f.profile.policyFiles, '../foreign': '0'.repeat(64) } } }));
  const profiles = verificationProfiles(JSON.parse(JSON.stringify({ __proto__: null, smoke: f.profile })));
  assert.equal(profileDigest(profiles.smoke!), profileDigest(f.profile));
  writeFileSync(join(f.engine, 'dist/cli.js'), 'process.exit(0)');
  const result = await runVerification(f.profile, new AbortController().signal);
  assert.equal(result.status, 'unverified'); assert.equal(result.cleanupSettled, true); assert.equal(existsSync(join(f.project, '.ready')), false);
});

test('actual child stop retains the interrupted dual handoff; forced termination retains uncertainty', async t => {
  for (const mode of ['hold', 'stubborn']) {
    const f = fixture(t, mode), abort = new AbortController();
    const running = runVerification(f.profile, abort.signal, mode === 'hold' ? 5000 : 50);
    await until(() => existsSync(join(f.project, '.ready'))); const pid = Number(readFileSync(join(f.project, '.ready'), 'utf8'));
    abort.abort(); const result = await running;
    assert.equal(result.status, mode === 'hold' ? 'interrupted' : 'unverified'); assert.equal(result.cleanupSettled, mode === 'hold');
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  }
});

test('verification child receives project settings without bridge, source or transport runtime variables', async t => {
  const keys = ['HANDOFF_SOURCE_KEY', 'FEISHU_APP_SECRET', 'AGENT_AUTOLOOP_RUN_TOKEN', 'BRIDGE_CONFIG', 'VERIFY_FIXTURE_SETTING'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = key === 'VERIFY_FIXTURE_SETTING' ? 'project-owned' : 'synthetic-runtime-value';
  try {
    const f = fixture(t, 'environment'), result = await runVerification(f.profile, new AbortController().signal);
    assert.equal(result.status, 'pass');
    assert.deepEqual(JSON.parse(readFileSync(join(f.project, '.environment.json'), 'utf8')), { runtimeVariables: [], projectSetting: 'project-owned' });
  } finally {
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
});

class ManagedFake extends FakeCodex implements ManagedCodex {
  async start() { this.ready = true; }
  async close() { this.exit(); }
}

function handoff(t: TestContext, mode = 'pass') {
  const f = fixture(t, mode, false), cwd = join(f.root, 'workspace'); mkdirSync(cwd);
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: cwd },
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { allowedUsers: ['ou_owner'], accessMode: 'allowlist', allowedTenant: 'tenant', enableGroups: false,
    groupContextMessages: 0, groupContextImages: 0, approvalUsers: ['ou_owner'], approvalChat: null, codexExecutable: 'codex',
    stateDirectory: join(f.root, 'state'), approvalTimeoutSeconds: 300, projects: scope.projects, projectRouting: 'workspace' };
  const admission = new PilotAdmission(config.stateDirectory, scope, 'workspace'), codex = new ManagedFake();
  const profiles = { smoke: f.profile }, native = new NativeExecutions(admission, config, () => codex, profiles);
  const sent: string[] = [];
  const sender = { send: async (_chat: string, text: string, id: string) => { sent.push(text); return id; } };
  const reactions = { addReaction: async () => 'reaction', findReaction: async () => undefined, removeReaction: async () => {} };
  let interactions = new PilotInteractions(admission, config, { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, [], undefined, profiles);
  let pending: Promise<unknown> | undefined;
  const launch = async (text = '/verify smoke Reply only NATIVE_DONE', status = 'completed', answer = 'NATIVE_DONE') => {
    const trigger = message(text, { chatType: 'p2p' });
    const admitted = interactions.receive(trigger); assert.ok('request' in admitted);
    const grant = admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start');
    if (grant.kind !== 'start') throw Error('no grant');
    const running = native.run(grant.permit); pending = running; await until(() => codex.calls.some(x => x.method === 'turn/start'));
    const call = codex.calls.find(x => x.method === 'turn/start')!;
    codex.complete(String(call.params.threadId), 'turn-2', status, answer);
    return { trigger, admitted, running, permit: grant.permit };
  };
  const restart = async () => { await interactions.close(); interactions = new PilotInteractions(admission, config,
    { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) }, native, sender, reactions, [], undefined, profiles); await interactions.start(); };
  t.after(async () => { await native.stop(); await pending?.catch(() => {}); await interactions.close(); admission.close(); rmSync(f.root, { recursive: true, force: true }); });
  return { ...f, config, scope, profiles, admission, codex, native, sent, launch, restart, get interactions() { return interactions; } };
}

async function drain(h: ReturnType<typeof handoff>) { for (let i = 0; i < 10; i++) await h.interactions.flush(); }

test('passing verification registers an exact report and resumes its original thread once', async t => {
  const h = handoff(t), task = await h.launch();
  const initial = await task.running;
  const { execution, project, conversation } = task.admitted.request;
  const actor = (text: string) => message(text, { chatType: 'p2p' });
  const lookup = () => h.admission.store.deliveryCheckpoint(task.trigger, project, execution);
  const observation = h.admission.store.verification(execution)!.observation!;
  const { summaryPath, htmlPath } = observation.integration!;
  const digest = fingerprint(JSON.stringify([fingerprint(readFileSync(summaryPath)), fingerprint(readFileSync(htmlPath))]));
  const reference = 'ui-eval:' + h.git(h.project, ['rev-parse', 'HEAD']) + '@sha256:' + digest;
  const register = '/delivery-wait ' + execution;
  h.interactions.receive(actor(register + ' unverified-reference'));
  assert.equal(h.interactions.receive(message(register, { chatType: 'group' })).status, 'ignored');
  await drain(h);
  assert.equal(lookup(), undefined);
  h.interactions.receive(actor(register));
  await drain(h);
  assert.equal(lookup()?.reference, reference);
  assert.equal(h.admission.store.requests().length, 1);
  await h.restart();
  h.interactions.receive(actor('/delivery ' + execution));
  await drain(h);
  assert.ok(h.sent.some(text => text.includes(reference) && text.includes('等待确认')));
  const confirm = '/delivery-confirm ' + execution + ' ';
  h.interactions.receive(actor(confirm + reference + '0\nCheck the result'));
  const html = readFileSync(htmlPath);
  writeFileSync(htmlPath, '<html>different report</html>');
  h.interactions.receive(actor(confirm + reference + '\nCheck the result'));
  await drain(h);
  assert.equal(lookup()?.resumed, null);
  assert.match(h.sent.at(-1)!, /stale.*报告已变化/);
  writeFileSync(htmlPath, html);

  const head = h.git(h.project, ['rev-parse', 'HEAD']);
  h.git(h.project, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-qm', 'new candidate']);
  h.interactions.receive(actor(confirm + reference + '\nCheck the result'));
  await drain(h);
  assert.equal(h.admission.store.requests().length, 1);
  assert.match(h.sent.at(-1)!, /stale.*源码/);
  h.git(h.project, ['checkout', '--detach', head]);

  const confirmation = actor(confirm + reference + '\nCheck the result');
  h.interactions.receive(confirmation);
  h.interactions.receive(confirmation);
  h.interactions.receive(actor(confirmation.text));
  await drain(h);
  const resumed = h.admission.store.request(lookup()!.resumed!)!;
  assert.equal(h.admission.store.requests().length, 2);
  assert.equal(resumed.conversation, conversation);
  assert.match(resumed.input, /Check the result/);
  assert.ok(resumed.input.includes(reference));
  const grant = h.admission.store.reserve(resumed.id, 2);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected continuation reservation');
  h.codex.calls.length = 0;
  const running = h.native.run(grant.permit);
  await until(() => h.codex.calls.some(call => call.method === 'turn/start'));
  assert.equal(h.codex.calls.find(call => call.method === 'thread/resume')?.params.threadId, initial.outcome.thread);
  h.codex.complete(initial.outcome.thread!, 'turn-3');
  assert.equal((await running).outcome.status, 'completed');
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
});

async function queuedVerifiedDelivery(h: ReturnType<typeof handoff>) {
  const task = await h.launch(); await task.running;
  const { execution, project } = task.admitted.request;
  const lookup = () => h.admission.store.deliveryCheckpoint(task.trigger, project, execution)!;
  h.interactions.receive(message('/delivery-wait ' + execution, { chatType: 'p2p' }));
  await drain(h);
  h.interactions.receive(message('/delivery-confirm ' + execution + ' ' + lookup().reference + '\nCheck the result', { chatType: 'p2p' }));
  await drain(h);
  const continuation = h.admission.store.request(lookup().resumed!)!;
  const grant = h.admission.store.reserve(continuation.id, 2);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw Error('Expected continuation reservation');
  return { grant, continuation, original: h.admission.store.verification(execution)! };
}

test('evidence drift before startup settles without a turn and retries a failed refusal projection', async t => {
  const h = handoff(t), { grant, continuation, original } = await queuedVerifiedDelivery(h);
  rmSync(original.observation!.integration!.summaryPath);
  h.codex.calls.length = 0;
  const report = await h.native.run(grant.permit);
  const state = h.interactions.transport.state, send = state.send.bind(state);
  state.send = (...args) => {
    if (args[1].includes('续接在启动前已结束')) throw Error('Synthetic refusal transport write failure');
    return send(...args);
  };
  try {
    await drain(h);
    assert.equal(state.projectedFinal(continuation.execution), false);
  } finally { state.send = send; }
  await h.restart(); await drain(h); await drain(h);
  assert.equal(report.outcome.status, 'interrupted');
  assert.equal(report.outcome.turn, null);
  assert.equal(h.codex.calls.length, 0);
  assert.deepEqual(h.admission.store.unsettled(), []);
  assert.deepEqual(h.admission.store.verification(original.execution), original);
  assert.equal(h.sent.filter(text => text.includes('续接在启动前已结束')).length, 1);
});

test('an evidence change during thread resume prevents turn submission', async t => {
  const h = handoff(t), { grant, original } = await queuedVerifiedDelivery(h);
  const request = h.codex.request.bind(h.codex);
  h.codex.request = async <T,>(method: string, input: unknown) => {
    if (method === 'thread/resume') rmSync(original.observation!.integration!.htmlPath);
    if (method === 'turn/start') throw Error('No model turn should be submitted with stale evidence');
    return request<T>(method, input);
  };
  h.codex.calls.length = 0;
  const report = await h.native.run(grant.permit);
  await drain(h);
  assert.ok(h.codex.calls.some(call => call.method === 'thread/resume'));
  assert.equal(report.outcome.status, 'interrupted');
  assert.equal(report.outcome.turn, null);
  assert.deepEqual(h.admission.store.unsettled(), []);
  assert.ok(h.sent.some(text => text.includes('交付证据已变化或无法核实，续接未启动')));
});

test('failed and dirty-source observations are ineligible for delivery waits', async t => {
  for (const mode of ['fail', 'pass']) {
    const h = handoff(t, mode);
    const dirty = join(h.project, 'uncommitted.txt');
    if (mode === 'pass') writeFileSync(dirty, 'not part of the Git commit');
    const task = await h.launch(); await task.running;
    if (mode === 'pass') rmSync(dirty);
    assert.equal(h.admission.store.verification(task.admitted.request.execution)!.observation!.status, mode);
    const wait = message('/delivery-wait ' + task.admitted.request.execution, { chatType: 'p2p' });
    h.interactions.receive(wait);
    await drain(h);
    assert.equal(h.admission.store.deliveryCheckpoint(wait, task.admitted.request.project, task.admitted.request.execution), undefined);
    assert.ok(h.sent.some(text => text.includes('交付证据不可用')));
  }
});

test('a delivery-view outbox failure leaves its receipt retryable without blocking synchronization', async t => {
  const h = handoff(t), task = await h.launch(); await task.running; await drain(h);
  const { execution } = task.admitted.request;
  h.interactions.receive(message('/delivery-wait ' + execution, { chatType: 'p2p' })); await drain(h);
  const state = h.interactions.transport.state, send = state.send.bind(state);
  const query = message('/delivery ' + execution, { chatType: 'p2p' });
  const prior = h.sent.length;
  state.send = () => { throw Error('Synthetic persistent outbox storage failure'); };
  try {
    h.interactions.receive(query);
    await assert.doesNotReject(h.interactions.flush());
    assert.equal(state.hasSeen(query), false);
  } finally { state.send = send; }
  h.interactions.receive(query); h.interactions.receive(query); await drain(h);
  assert.equal(h.sent.slice(prior).filter(text => text.includes('等待确认这份证据')).length, 1);
  assert.equal(h.admission.store.requests().length, 1);
});

test('findings reads sealed failure once across duplicate deliveries/restart without executing or altering evidence', async t => {
  const h = handoff(t, 'fail'), task = await h.launch(); await task.running; await drain(h);
  const execution = task.admitted.request.execution, observation = h.admission.store.verification(execution)!;
  const journal = join(h.config.stateDirectory, 'executions', execution, 'bridge.db');
  const before = { requests: h.admission.store.requests(), observation, guards: h.admission.store.unsettled(),
    submission: h.admission.store.submission(task.admitted.request.id), calls: h.codex.calls.length, journal: readFileSync(journal),
    json: readFileSync(observation.observation!.integration!.summaryPath), html: readFileSync(observation.observation!.integration!.htmlPath) };
  const query = message('/findings', { chatType: 'p2p' });
  h.interactions.receive(query); h.interactions.receive(query); await drain(h);
  const answers = () => h.sent.filter(x => x.includes('验证线索') && x.includes('/verification ' + execution));
  assert.equal(answers().length, 1); assert.match(answers()[0]!, /历史观测：验证未通过/); assert.match(answers()[0]!, /历史观测，Git/);
  await h.restart(); h.interactions.receive(query); await drain(h); assert.equal(answers().length, 1);
  assert.deepEqual(h.admission.store.requests(), before.requests); assert.deepEqual(h.admission.store.verification(execution), before.observation);
  assert.deepEqual(h.admission.store.unsettled(), before.guards); assert.deepEqual(h.admission.store.submission(task.admitted.request.id), before.submission);
  assert.equal(h.codex.calls.length, before.calls); assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  assert.deepEqual(readFileSync(journal), before.journal); assert.deepEqual(readFileSync(observation.observation!.integration!.summaryPath), before.json);
  assert.deepEqual(readFileSync(observation.observation!.integration!.htmlPath), before.html);
  writeFileSync(observation.observation!.integration!.htmlPath, 'changed');
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h); assert.match(answers().at(-1)!, /stale/);
  writeFileSync(journal, 'changed native evidence');
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h);
  assert.match(answers().at(-1)!, /封存证据无法核实/); assert.doesNotMatch(answers().at(-1)!, /历史观测：验证未通过/);
});

test('findings enforces owner/chat/approval boundary and malformed commands never become tasks', async t => {
  const h = handoff(t);
  for (const overrides of [{ user: 'other' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }, { unsupported: 'image' }]) {
    h.interactions.receive(message('/findings', { chatType: 'p2p', ...overrides }));
  }
  h.config.approvalUsers = [];
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h); assert.equal(h.sent.length, 0);
  h.config.approvalUsers = ['ou_owner'];
  h.interactions.receive(message('/findings extra', { chatType: 'p2p' })); await drain(h);
  assert.match(h.sent.at(-1)!, /请发送 \/findings/); assert.equal(h.admission.store.requests().length, 0); assert.equal(h.codex.calls.length, 0);
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h);
  assert.match(h.sent.at(-1)!, /需核对 0 个/); assert.match(h.sent.at(-1)!, /空列表不代表项目没有问题/);
});

test('persistent findings answer failure rolls back receipt without poisoning synchronization or shutdown', async t => {
  const h = handoff(t), state = h.interactions.transport.state, send = state.send.bind(state);
  const query = message('/findings', { chatType: 'p2p' });
  state.send = () => { throw Error('Synthetic persistent outbox storage failure'); };
  try {
    h.interactions.receive(query);
    await assert.doesNotReject(h.interactions.flush());
    const db = new DatabaseSync(join(h.config.stateDirectory, 'transport/bridge.db'), { readOnly: true });
    assert.equal(db.prepare('select count(*) n from seen where tenant=? and id=?').get(query.tenant, query.id)!.n, 0);
    assert.equal(db.prepare('select count(*) n from outbox').get()!.n, 0); db.close();
  } finally { state.send = send; }
  await assert.doesNotReject(h.interactions.flush());
  await h.restart(); h.interactions.receive(query); h.interactions.receive(query); await drain(h);
  assert.equal(h.sent.filter(x => x.includes('验证线索')).length, 1);
  assert.equal(h.admission.store.requests().length, 0); assert.equal(h.codex.calls.length, 0);
  await assert.doesNotReject(h.interactions.close());
});

test('findings selects latest profile before filtering, scopes history in SQLite and bounds displayed leads', async t => {
  const h = handoff(t, 'fail'), task = await h.launch(); await task.running; await drain(h);
  const accept = (profile: string, overrides = {}) => {
    const result = h.admission.store.accept(message('Synthetic verification', { chatType: 'p2p', ...overrides }), 'task', h.admission.project,
      { profile, definition: h.profile }); assert.ok('request' in result); return result.request;
  };
  const latest = accept('smoke');
  accept('foreign', { user: 'other' });
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h);
  assert.match(h.sent.at(-1)!, new RegExp(latest.execution)); assert.doesNotMatch(h.sent.at(-1)!, new RegExp(task.admitted.request.execution));
  assert.doesNotMatch(h.sent.at(-1)!, /foreign/); assert.match(h.sent.at(-1)!, /尚无已收尾/);
  const grant = h.admission.store.reserve(latest.id, 2); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') return;
  h.admission.store.beginVerification(grant.permit);
  h.admission.store.finishVerification(grant.permit, { ...h.admission.store.verification(task.admitted.request.execution)!.observation!, status: 'pass' });
  h.admission.terminal(grant.permit, { status: 'completed', processSettled: true, reference: 'synthetic-pass' });
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h); assert.match(h.sent.at(-1)!, /需核对 0 个/);
  for (let i = 0; i < 101; i++) accept('profile' + i);
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h);
  const answer = h.sent.at(-1)!;
  assert.match(answer, /需核对 100 个 profile（显示最新 10 个）/); assert.match(answer, /最近 100 条验证任务/);
  assert.equal((answer.match(/\/verification [0-9a-f-]{36}/g) ?? []).length, 10); assert.match(answer, /profile100/); assert.doesNotMatch(answer, /profile90/);
});

test('findings keeps verification cleanup uncertainty protected and does not invoke recovery', async t => {
  const h = handoff(t, 'missing-html'), task = await h.launch(); await task.running; await drain(h);
  const before = h.admission.store.unsettled(); assert.equal(before.length, 1);
  h.interactions.receive(message('/findings', { chatType: 'p2p' })); await drain(h);
  assert.match(h.sent.at(-1)!, /结果未确认；请先检查进程与副作用/);
  assert.deepEqual(h.admission.store.unsettled(), before); assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
});

test('selected native owner holds the actual SQLite guard during verification and projects once across restart', async t => {
  const h = handoff(t, 'hold'), task = await h.launch();
  await until(() => existsSync(join(h.project, '.ready')));
  assert.equal(h.admission.store.verification(task.admitted.request.execution)!.phase, 'running');
  const other = new PilotAdmission(h.config.stateDirectory, h.scope, 'workspace');
  const queued = other.receive(message('another task', { chatType: 'p2p' })); assert.ok('request' in queued);
  assert.equal(other.store.reserve(queued.request.id, 2).kind, 'busy');
  other.store.withdraw(message('/withdraw ' + queued.request.execution, { chatType: 'p2p' }), queued.request.execution, other.project); other.close();
  h.interactions.receive(message('/status', { chatType: 'p2p' })); await drain(h);
  assert.ok(h.sent.some(x => x.includes('项目验证正在运行')));
  await h.restart(); assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  h.interactions.receive(message('/stop', { chatType: 'p2p' }));
  await h.interactions.flush(); await task.running; await drain(h);
  const v = h.admission.store.verification(task.admitted.request.execution)!;
  assert.equal(v.phase, 'observed'); assert.equal(v.observation!.status, 'interrupted');
  assert.equal(h.admission.store.unsettled().length, 0);
  const db = readFileSync(join(h.config.stateDirectory, 'executions', task.admitted.request.execution, 'bridge.db'));
  assert.equal(h.sent.filter(x => x.includes('NATIVE_DONE')).length, 1);
  assert.equal(h.sent.filter(x => x.includes('验证观测：interrupted')).length, 1);
  h.interactions.receive(task.trigger); await drain(h); await h.restart(); await drain(h);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  assert.equal(h.sent.filter(x => x.includes('NATIVE_DONE')).length, 1);
  assert.equal(h.sent.filter(x => x.includes('验证观测：interrupted')).length, 1);
  assert.deepEqual(readFileSync(join(h.config.stateDirectory, 'executions', task.admitted.request.execution, 'bridge.db')), db);
  assert.equal(h.codex.calls.filter(x => x.method === 'turn/start').length, 1);
  assert.equal((await h.native.run(task.permit)).checkpoint, h.native.evidence(task.permit.execution).checkpoint);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
});

test('completed native outcome remains separate from an unconfirmed verification and guarded after restart', async t => {
  const h = handoff(t, 'missing-html'), task = await h.launch(); await task.running; await drain(h);
  const report = h.native.evidence(task.admitted.request.execution);
  assert.equal(report.outcome.status, 'completed');
  assert.match(executionReceipt('verification_unknown'), /Native Codex completed; verification outcome/);
  assert.match(executionReceipt('verification_unknown'), /verification-outcome-unconfirmed/);
  assert.match(executionReceipt('unknown'), /native-outcome-unconfirmed/);
  assert.equal(h.admission.store.execution(task.admitted.request.execution)!.status, 'unknown');
  assert.equal(h.admission.store.verification(task.admitted.request.execution)!.phase, 'unknown');
  await h.restart(); assert.equal(h.admission.store.unsettled().length, 1);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  assert.ok(h.sent.some(x => x.includes('NATIVE_DONE')));
  assert.ok(h.sent.some(x => x.includes('验证结果或清理未确认')));
  h.interactions.receive(message('/status', { chatType: 'p2p' })); await drain(h);
  assert.ok(h.sent.some(x => x.includes('原生/验证执行保护仍保留') && x.includes('本机检查') && !x.includes('/recover')));
  const blocked = h.interactions.receive(message('/verify smoke Another task', { chatType: 'p2p' })); assert.ok('request' in blocked);
  assert.equal(blocked.status, 'blocked'); assert.equal(h.admission.store.verification(blocked.request.execution)!.phase, 'skipped');
  await drain(h); assert.ok(h.sent.some(x => x.includes('本次未开始且不会自动执行')));
  h.admission.store.reconcileLocal(randomUUID(), task.admitted.request.execution, 'synthetic process/effect inspection');
  assert.equal(h.admission.store.unsettled().length, 0);
  h.interactions.receive(message('/verification ' + task.admitted.request.execution, { chatType: 'p2p' })); await drain(h);
  assert.ok(h.sent.some(x => x.includes('当前该任务无执行保护') && x.includes('验证结果或清理未确认')));
});

test('historical applicability detects profile/report/HEAD drift without launching another invocation', async t => {
  const h = handoff(t), task = await h.launch(); await task.running;
  const value = h.admission.store.verification(task.admitted.request.execution)!;
  assert.match(await verificationApplicability(value, h.profiles), /历史观测/);
  assert.match(await verificationApplicability(value, { smoke: { ...h.profile, suite: 'other' } }), /stale/);
  h.git(h.project, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '--allow-empty', '-qm', 'new source']);
  assert.match(await verificationApplicability(value, h.profiles), /stale/);
  writeFileSync(value.observation!.integration!.htmlPath, 'changed');
  assert.match(await verificationApplicability(value, h.profiles), /stale/);
  h.interactions.receive(message('/verification ' + task.admitted.request.execution, { user: 'other', chatType: 'p2p' }));
  await h.interactions.flush(); assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
});

test('ignored registered policy drift becomes stale without changing history or launching work', async t => {
  const h = handoff(t), policy = 'ignored-policy.json';
  writeFileSync(join(h.project, '.gitignore'), readFileSync(join(h.project, '.gitignore'), 'utf8') + policy + '\n');
  h.git(h.project, ['add', '.gitignore']);
  h.git(h.project, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'ignore policy fixture']);
  writeFileSync(join(h.project, policy), '{"required":true}');
  h.profile.policyFiles[policy] = fingerprint(readFileSync(join(h.project, policy)));
  const task = await h.launch(); await task.running; await drain(h);
  const execution = task.admitted.request.execution, value = h.admission.store.verification(execution)!;
  const journal = join(h.config.stateDirectory, 'executions', execution, 'bridge.db');
  const bytes = readFileSync(journal), head = h.git(h.project, ['rev-parse', 'HEAD']);
  assert.match(await verificationApplicability(value, h.profiles), /历史观测/);
  writeFileSync(join(h.project, policy), '{"required":false}');
  assert.equal(h.git(h.project, ['status', '--porcelain', '--untracked-files=all']), '');
  assert.equal(h.git(h.project, ['rev-parse', 'HEAD']), head);
  await h.restart();
  h.interactions.receive(message('/verification ' + execution, { chatType: 'p2p' })); await drain(h);
  assert.ok(h.sent.some(text => text.includes('stale') && text.includes('验证规则')));
  assert.deepEqual(h.admission.store.verification(execution), value);
  assert.deepEqual(readFileSync(journal), bytes);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  assert.equal(h.codex.calls.filter(call => call.method === 'turn/start').length, 1);
});

test('verification selection requires exact private owner/approval authority and immutable task admission', async t => {
  const h = handoff(t);
  const text = '/verify smoke Task';
  for (const overrides of [{ user: 'other' }, { tenant: 'other' }, { chat: 'other' }, { chatType: 'group' as const }, { unsupported: 'file' }]) {
    h.interactions.receive(message(text, { chatType: 'p2p', ...overrides }));
  }
  h.config.approvalUsers = []; h.interactions.receive(message(text, { chatType: 'p2p' })); h.config.approvalUsers = ['ou_owner'];
  for (const invalid of ['/verify toString Task', '/verify __proto__ Task', '/verify missing Task', '/verify smoke']) h.interactions.receive(message(invalid, { chatType: 'p2p' }));
  assert.equal(h.admission.store.requests().length, 0);
  const trigger = message(text, { chatType: 'p2p' });
  const result = h.interactions.receive(trigger); assert.ok('request' in result);
  const before = h.admission.store.verification(result.request.execution)!;
  h.interactions.receive({ ...trigger, text: '/verify smoke Different text' });
  assert.deepEqual(h.admission.store.verification(result.request.execution), before);
  assert.equal(h.admission.store.requests().length, 1);
  h.interactions.receive(message('/withdraw ' + result.request.execution, { chatType: 'p2p' }));
  assert.equal(h.admission.store.verification(result.request.execution)!.phase, 'skipped');
  assert.equal(existsSync(join(h.project, '.spawns')), false);
  const large = h.interactions.receive(message('/verify smoke ' + 'x'.repeat(29_980), { chatType: 'p2p' }));
  assert.ok('request' in large); assert.ok(large.request.input.length > 30_000);
  h.interactions.receive(message('/withdraw ' + large.request.execution, { chatType: 'p2p' }));
});

test('ordinary tasks and interrupted native tasks do not invoke a verification child', async t => {
  const ordinary = handoff(t), normal = await ordinary.launch('Reply only NATIVE_DONE'); await normal.running; await drain(ordinary);
  assert.equal(ordinary.admission.store.verification(normal.admitted.request.execution), undefined);
  assert.equal(existsSync(join(ordinary.project, '.spawns')), false);
  const interrupted = handoff(t), task = await interrupted.launch(undefined, 'interrupted'); await task.running; await drain(interrupted);
  assert.equal(interrupted.admission.store.verification(task.admitted.request.execution)!.phase, 'skipped');
  assert.equal(existsSync(join(interrupted.project, '.spawns')), false);
  assert.equal(interrupted.admission.store.unsettled().length, 0);
});

test('native startup failure seals skipped verification without inventing a launched verifier', async t => {
  const h = handoff(t);
  h.codex.start = async () => { throw Error('fixture native startup failure'); };
  const admitted = h.interactions.receive(message('/verify smoke Task', { chatType: 'p2p' })); assert.ok('request' in admitted);
  const grant = h.admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') return;
  const report = await h.native.run(grant.permit);
  assert.equal(report.outcome.status, 'interrupted');
  assert.equal(h.admission.store.verification(admitted.request.execution)!.phase, 'skipped');
  assert.equal(existsSync(join(h.project, '.spawns')), false); assert.equal(h.admission.store.unsettled().length, 0);
});

test('profile drift after admission cannot select different executable bytes or launch a verification child', async t => {
  for (const name of ['smoke', 'constructor']) {
    const h = handoff(t);
    h.profiles.smoke = { ...h.profile, suite: 'changed' };
    // The original reviewed selection is now changed or removed from this Worker's registry.
    const received = h.admission.receiveVerification(message(`/verify ${name} Task`, { chatType: 'p2p' }), 'Task', { profile: name, definition: h.profile });
    assert.ok('request' in received); const grant = h.admission.store.reserve(received.request.id, 1); assert.equal(grant.kind, 'start');
    if (grant.kind !== 'start') throw Error('no grant');
    const running = h.native.run(grant.permit); await until(() => h.codex.calls.some(x => x.method === 'turn/start'));
    h.codex.complete('thread-1', 'turn-2'); await running;
    const observation = h.admission.store.verification(received.request.execution)!;
    assert.equal(observation.observation!.status, 'unverified'); assert.equal(observation.phase, 'observed');
    assert.match(await verificationApplicability(observation, {}), /stale/);
    assert.equal(existsSync(join(h.project, '.spawns')), false); assert.equal(h.admission.store.unsettled().length, 0);
  }
});

test('native policy edits and an unpinned verification plan cannot weaken the registered acceptance floor', async t => {
  const h = handoff(t);
  const received = h.interactions.receive(message('/verify smoke Task', { chatType: 'p2p' })); assert.ok('request' in received);
  const grant = h.admission.store.reserve(received.request.id, 1); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') return;
  const running = h.native.run(grant.permit); await until(() => h.codex.calls.some(x => x.method === 'turn/start'));
  const path = 'ui-eval/integrations/smoke.json';
  writeFileSync(join(h.project, path), '{"id":"smoke","projectId":"fixture","adapter":"web","scenarios":[]}');
  h.codex.complete('thread-1', 'turn-2'); await running;
  assert.equal(h.admission.store.verification(received.request.execution)!.observation!.status, 'unverified');
  assert.equal(existsSync(join(h.project, '.spawns')), false);
  const f = fixture(t);
  writeFileSync(join(f.project, path), '{"id":"smoke","projectId":"fixture","adapter":"web","verificationPlan":"ui-eval/verification.json"}');
  f.profile.policyFiles[path] = fingerprint(readFileSync(join(f.project, path)));
  const result = await runVerification(f.profile, new AbortController().signal);
  assert.equal(result.status, 'unverified'); assert.equal(result.cleanupSettled, true);
  assert.equal(existsSync(join(f.project, '.spawns')), false);
});

test('verification handoff preserves long native chunks and independent bounded delivery across restart', async t => {
  const h = handoff(t), task = await h.launch(undefined, 'completed', 'NATIVE_DONE\n' + '😀'.repeat(10_000));
  await task.running;
  for (let i = 0; i < 30; i++) await h.interactions.flush();
  const journal = new DatabaseSync(join(h.config.stateDirectory, 'executions', task.permit.execution, 'bridge.db'), { readOnly: true });
  const bodies = journal.prepare('SELECT body FROM outbox WHERE final=1 ORDER BY sequence').all() as { body: string }[]; journal.close();
  for (const { body } of bodies) assert.ok(h.sent.includes(body), 'Native chunk must not grow after journal splitting');
  assert.ok(h.sent.every(x => Array.from(x).length <= 3000));
  assert.equal(h.sent.filter(x => x.includes('验证观测：pass')).length, 1);
  await h.restart(); await drain(h);
  assert.equal(h.sent.filter(x => x.includes('验证观测：pass')).length, 1);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
});

test('actual owner process loss retains the launched intent/guard and cannot replay the native or verification child', async t => {
  const h = handoff(t, 'hold');
  const admitted = h.interactions.receive(message('/verify smoke Task', { chatType: 'p2p' })); assert.ok('request' in admitted);
  const grant = h.admission.store.reserve(admitted.request.id, 1); assert.equal(grant.kind, 'start'); if (grant.kind !== 'start') return;
  const packet = join(h.root, 'owner-packet.json'); writeFileSync(packet, JSON.stringify({ config: h.config, scope: h.scope, profiles: h.profiles, permit: grant.permit }));
  const owner = spawn(process.execPath, ['--import', 'tsx', 'test/fixtures/verification-owner.ts', packet], { stdio: ['ignore', 'pipe', 'pipe'] });
  owner.stdout.resume(); owner.stderr.resume();
  let pid: number | undefined, started: string | undefined;
  const stopFixtureChild = (signal: NodeJS.Signals) => {
    if (!pid || !started) return;
    try {
      const birth = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
      if (birth === started) process.kill(pid, signal);
    } catch { /* Already exited; never act on a reused PID. */ }
  };
  t.after(async () => { if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL'); stopFixtureChild('SIGKILL'); });
  await until(() => existsSync(join(h.project, '.ready'))); pid = Number(readFileSync(join(h.project, '.ready'), 'utf8'));
  started = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim();
  assert.equal(h.admission.store.verification(admitted.request.execution)!.phase, 'running');
  const ended = once(owner, 'exit'); owner.kill('SIGKILL'); await ended;
  stopFixtureChild('SIGTERM');
  await h.native.recover();
  assert.equal(h.admission.store.execution(admitted.request.execution)!.status, 'unknown');
  assert.equal(h.admission.store.unsettled().length, 1);
  assert.throws(() => h.admission.store.startableRequest(grant.permit), /launch authority/);
  await assert.rejects(h.native.run(grant.permit));
  await h.restart(); await drain(h);
  assert.equal(readFileSync(join(h.project, '.spawns'), 'utf8'), '1');
  assert.equal(h.admission.store.verification(admitted.request.execution)!.phase, 'running');
  h.admission.store.reconcileLocal(randomUUID(), admitted.request.execution, 'Controlled lost-owner fixture processes/effects inspected');
  assert.equal(h.admission.store.verification(admitted.request.execution)!.phase, 'unknown');
  assert.equal(h.admission.store.unsettled().length, 0);
});
