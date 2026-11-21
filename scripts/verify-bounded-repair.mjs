// Explicit isolated acceptance: actual pinned Hub/Worker, app-server protocol and UI-eval CLI.
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, cpSync, mkdirSync, realpathSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { pinnedSource } from '../experiments/autoloop/pinned-source.mjs';
import { verificationProfiles, fingerprint, verifyEngine } from '../dist/handoff/verification-profile.js';
import { PilotAdmission, REQUEST_EVENT } from '../dist/handoff/gateway.js';
import { NativeExecutions } from '../dist/handoff/native.js';
import { PilotInteractions } from '../dist/handoff/interactions.js';
import { AutoloopSource, SourceOutbox } from '../dist/handoff/source.js';
import { loadConfig } from '../dist/config.js';

const arg = name => process.argv[process.argv.indexOf(name) + 1];
for (const name of ['--engine', '--revision', '--autoloop', '--output', '--browser-channel']) if (!process.argv.includes(name)) throw Error('Required: ' + name);
process.umask(0o077);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), requestedOutput = resolve(arg('--output'));
mkdirSync(requestedOutput, { mode: 0o700 }); // Refuse any existing output, retaining prior evidence.
const output = realpathSync(requestedOutput);
const runtimeFingerprint = () => fingerprint(JSON.stringify(readdirSync(join(root, 'dist'), { recursive: true }).filter(p => p.endsWith('.js')).sort()
  .map(p => [p, fingerprint(readFileSync(join(root, 'dist', p)))])));
const bridgeCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), bridgeRuntimeHash = runtimeFingerprint();
const engine = realpathSync(arg('--engine')), revision = arg('--revision'), upstream = pinnedSource(arg('--autoloop'));
const candidate = join(output, 'candidate'), state = join(output, 'state'), home = join(output, 'home');
const workerLaunches = join(output, 'worker-launches');
mkdirSync(workerLaunches, { mode: 0o700 });
const native = process.argv.includes('--native'), audit = join(output, 'native-audit.jsonl');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, read, timeout = 480_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await read(); if (result) return result; await pause(100); }
  throw Error('Timed out: ' + label);
}
async function port() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; }
const build = { engineRoot: engine, engineRevision: revision, cliHash: fingerprint(readFileSync(join(engine, 'dist/cli.js'))), libraryHash: fingerprint(readFileSync(join(engine, 'dist/index.js'))) };
await verifyEngine(build);
cpSync(join(engine, 'examples/prepared-web'), candidate, { recursive: true });
execFileSync(process.execPath, [join(engine, 'dist/cli.js'), 'init', '--route', '/', '--scenario', 'home', '--yes', '--project-root', candidate], { stdio: 'pipe', timeout: 30_000 });
const projectPath = join(candidate, 'ui-eval/project.json'), project = JSON.parse(readFileSync(projectPath, 'utf8'));
project.projectId = 'prepared-web'; project.devServer = { command: process.execPath, args: ['server.mjs'], url: `http://127.0.0.1:${await port()}`, reuseExisting: false, startupTimeoutMs: 15_000 };
project.baseUrls.local = project.devServer.url; writeFileSync(projectPath, JSON.stringify(project));
const suitePath = join(candidate, 'ui-eval/integrations/smoke.json'), suite = JSON.parse(readFileSync(suitePath, 'utf8'));
suite.checks = []; suite.browserChannel = arg('--browser-channel'); writeFileSync(suitePath, JSON.stringify(suite));
const scenarioPath = join(candidate, 'ui-eval/scenarios/home.json'), scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
scenario.checkpoints[0].assertions.push({ id: 'repair-title', kind: 'text', target: { platform: 'web', by: 'css', value: 'h1' }, expected: 'REPAIRED_TITLE' });
writeFileSync(scenarioPath, JSON.stringify(scenario));
writeFileSync(join(candidate, 'page.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Repair fixture</title><main><h1>BROKEN_TITLE</h1></main></html>');
const pkg = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8'));
writeFileSync(join(candidate, 'ui-eval/engine.json'), JSON.stringify({ repository: pkg.repository.url, revision, bunVersion: pkg.packageManager.slice(4) }));
for (const argv of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'isolated bounded repair fixture']]) execFileSync('git', ['-C', candidate, ...argv], { stdio: 'pipe' });
const policyPaths = execFileSync('git', ['-C', candidate, 'ls-files', '-z', 'ui-eval', 'prepare.mjs', 'server.mjs'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const workerTimeoutMinutes = 10;
const fixture = { ...build, projectRoot: candidate, projectId: 'prepared-web', suite: 'smoke', timeoutMs: 60_000,
  policyFiles: Object.fromEntries(policyPaths.map(p => [p, fingerprint(readFileSync(join(candidate, p)))])),
  repair: { scenarios: ['home'], timeoutMs: 300_000 } };
const profiles = verificationProfiles({
  fixture,
  'over-budget': { ...fixture, repair: { ...fixture.repair, timeoutMs: (workerTimeoutMinutes - 1) * 60_000 } },
});
mkdirSync(home, { mode: 0o700 }); writeFileSync(audit, '');
const url = 'http://127.0.0.1:' + await port();
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AGENT_AUTOLOOP_|HANDOFF_|BRIDGE_PROBE_|FEISHU_)/.test(name) && name !== 'NODE_TEST_CONTEXT'));
Object.assign(env, { AGENT_AUTOLOOP_HOME: home, SHELL: '/bin/sh',
  HANDOFF_RUNNER: join(root, 'test/fixtures/record-worker-launch.mjs'),
  BRIDGE_PROBE_REPAIR_RUNNER: join(root, 'dist/handoff/run-assignment.js'),
  BRIDGE_PROBE_WORKER_LAUNCHES: workerLaunches });
const cli = ['--disable-warning=ExperimentalWarning', join(upstream, 'bin/agent-autoloop.ts')];
writeFileSync(join(home, 'rules.json'), JSON.stringify({ sources: { fixture: { name: 'Fixture' } },
  agents: { native: { name: 'Fixture native', worker: 'fixture-worker', use: 'bridge-native', access: 'read', timeout: workerTimeoutMinutes } }, channels: { fixture: { name: 'Synthetic destination' } },
  rules: [{ name: 'pilot', to: 'native', cwd: candidate, group: 'fixture', parallel: 1, resume: false,
    when: { source: 'fixture', types: [REQUEST_EVENT] }, prompt: 'Task authority belongs to immutable admission state.', tell: 'always' }] }));
const key = (kind, name) => { const r = spawnSync(process.execPath, [...cli, 'key', 'new', kind, name], { env, encoding: 'utf8' }); assert.equal(r.status, 0); return r.stdout.trim().split('\n').at(-1); };
key('owner', 'fixture-owner'); const workerKey = key('worker', 'fixture-worker'), sourceKey = key('source', 'fixture');
writeFileSync(join(home, 'config.json'), JSON.stringify({ url, hub: { listen: url.slice('http://'.length) }, worker: { name: 'fixture-worker', key: workerKey, capacity: 1 }, channels: {} }));
mkdirSync(join(home, 'plugins/bridge-native'), { recursive: true }); copyFileSync(join(root, 'integrations/autoloop/bridge-native/agent.ts'), join(home, 'plugins/bridge-native/agent.ts'));
const scope = { installation: 'repair-fixture', tenant: 'fixture', operator: 'ou_fixture_owner', chat: 'oc_fixture_chat', projects: { pilot: candidate },
  pilot: 'pilot', hubInstance: 'fixture-hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
const configPath = join(output, 'bridge.config.json'), handoffPath = join(output, 'handoff.config.json');
writeFileSync(configPath, JSON.stringify({ allowedUsers: [scope.operator], allowedTenant: scope.tenant, enableGroups: false,
  approvalUsers: [scope.operator], approvalChat: null, codexExecutable: native ? arg('--codex') || 'codex' : process.execPath, stateDirectory: state, projects: scope.projects, projectRouting: 'workspace' }));
writeFileSync(handoffPath, JSON.stringify({ scope, stateDirectory: state, bridgeConfig: configPath, hubUrl: url, verificationProfiles: profiles }));
Object.assign(env, { HANDOFF_CONFIG: handoffPath, HANDOFF_SOURCE_KEY: sourceKey,
  HANDOFF_CODEX_PREFIX: native ? '[]' : JSON.stringify([join(root, 'test/fixtures/codex-repair-probe.mjs'), audit, join(candidate, 'page.html')]) });
const admission = new PilotAdmission(state, scope, 'workspace'), runtime = new NativeExecutions(admission, loadConfig(configPath), undefined, profiles);
const sourceClient = new AutoloopSource(url, sourceKey);
const source = new SourceOutbox(admission, sourceClient), deliveries = [];
const reactions = { addReaction: async () => 'fixture-reaction', findReaction: async () => undefined, removeReaction: async () => {} };
let interactions = new PilotInteractions(admission, loadConfig(configPath), source, runtime, { send: async (_chat, text, id, options) => { deliveries.push({ text, id, options }); return id; } }, reactions, [sourceKey], undefined, profiles);
let up;
try {
  up = spawn(process.execPath, [...cli, 'up'], { env, stdio: ['ignore', 'ignore', 'ignore'] });
  await until('Hub', () => fetch(url + '/healthz').then(x => x.ok).catch(() => false), 30_000);
  const actor = text => ({ tenant: scope.tenant, user: scope.operator, chat: scope.chat, chatType: 'p2p', id: randomUUID(), text });
  const overBudget = interactions.receive(actor('/verify-repair over-budget Isolated budget preflight'));
  assert.ok('request' in overBudget);
  const rejectedExecution = overBudget.request.execution;
  const rejected = await until('Worker settlement with insufficient budget', async () => {
    await interactions.flush();
    const event = admission.store.submission(overBudget.request.id)?.event;
    if (!event) return;
    const { runs } = await sourceClient.inspect(event);
    const run = runs[0];
    if (!run || run.state === 'queued' || run.state === 'claimed') return;
    assert.equal(run.state, 'nothing');
    const goal = admission.store.repairs.get(rejectedExecution);
    assert.equal(goal?.status, 'incomplete');
    assert.match(goal.reason, /actual Worker budget is insufficient/);
    const launch = JSON.parse(readFileSync(join(workerLaunches, run.run + '.json'), 'utf8'));
    assert.equal(launch.run, run.run);
    assert.equal(launch.rule, run.rule);
    const workerDeadline = launch.launchedAt + launch.timeoutMinutes * 60_000;
    assert.ok(goal.deadline < workerDeadline, 'The work window fits the actual Worker deadline');
    assert.ok(workerDeadline < goal.cleanupDeadline, 'The actual Worker deadline leaves insufficient cleanup time');
    assert.equal(goal.attempts.length, 0);
    assert.equal(readFileSync(audit, 'utf8'), '');
    assert.equal(admission.store.unsettled().length, 0);
    return { execution: rejectedExecution, run: run.run, status: goal.status, attempts: goal.attempts.length,
      workerDeadline, workDeadline: goal.deadline, cleanupDeadline: goal.cleanupDeadline };
  }, 30_000);
  console.log('PASS: the work window fits the Worker timeout, but cleanup does not; no native or verifier launch.');
  const trigger = actor('/verify-repair fixture 隔离验收：目标是让 page.html 的 h1 为 REPAIRED_TITLE。首轮请仅回复 REPAIR_PROBE_FIRST，不使用工具、不修改文件；待系统验证后，在唯一修复续接轮读取报告并修复 page.html，保持所有 ui-eval 策略、脚本和断言不变。只修改这个隔离目录。');
  const result = interactions.receive(trigger); assert.ok('request' in result); const execution = result.request.execution;
  await interactions.flush();
  await until('bounded goal', async () => { await interactions.flush(); return admission.store.repairs.get(execution)?.status; });
  const goal = admission.store.repairs.get(execution), report = runtime.evidence(execution);
  writeFileSync(join(output, 'goal.json'), JSON.stringify(goal, null, 2));
  assert.equal(goal.status, 'pass', goal.reason); assert.equal(goal.attempts.length, 2);
  assert.equal(goal.attempts[0].observation.status, 'fail'); assert.equal(goal.attempts[1].observation.status, 'pass');
  assert.equal(goal.attempts[0].native.outcome.thread, goal.attempts[1].native.outcome.thread);
  assert.notEqual(goal.attempts[0].native.outcome.generation, goal.attempts[1].native.outcome.generation);
  const before = admission.store.repairs.binding(execution);
  interactions.receive(trigger); interactions.receive(actor('/verification ' + execution));
  await interactions.close();
  interactions = new PilotInteractions(admission, loadConfig(configPath), source, runtime, { send: async (_chat, text, id, options) => { deliveries.push({ text, id, options }); return id; } }, reactions, [sourceKey], undefined, profiles);
  await interactions.recover(); for (let i = 0; i < 4; i++) await interactions.flush();
  const owner = JSON.parse(readFileSync(join(state, 'executions', execution, 'native-owner.json'), 'utf8'));
  assert.equal((await runtime.run(owner.permit)).checkpoint, report.checkpoint); assert.equal(admission.store.repairs.binding(execution), before);
  assert.equal(deliveries.filter(d => d.text === 'REPAIR_PROBE_FIRST').length, 0); assert.equal(new Set(deliveries.map(d => d.id)).size, deliveries.length);
  assert.equal(admission.store.unsettled().length, 0);
  assert.equal(runtimeFingerprint(), bridgeRuntimeHash, 'Captured bridge runtime must remain unchanged');
  writeFileSync(join(output, 'acceptance.json'), JSON.stringify({ status: 'passed', nativeInference: native, scope: 'isolated actual Hub/Worker and UI-eval; synthetic human transport; no Feishu connection or business acceptance',
    bridgeCommit, bridgeRuntimeHash, budgetRejection: rejected, execution, attempts: goal.attempts.map(a => ({ id: a.id, native: a.native, observation: a.observation })), checkpoint: report.checkpoint, manifestHash: before }, null, 2));
  console.log('PASS: isolated fail → same-conversation repair → fresh pass; immutable attempt evidence and lookup-only restart.');
  console.log(native ? 'Actual Codex inference was used; real Feishu owner acceptance remains separate.' : 'Native protocol was scripted; actual pinned Hub/Worker, UI-eval and Chrome executed. No model inference.');
  console.log('Private evidence: ' + output);
} finally {
  await interactions.close();
  if (up?.exitCode === null) { const done = new Promise(r => up.once('exit', r)); up.kill('SIGTERM'); await done; }
  const runs = join(home, 'worker/runs');
  if (existsSync(runs)) for (const id of readdirSync(runs)) {
    const file = join(runs, id, 'entry.json');
    if (existsSync(file)) { const entry = JSON.parse(readFileSync(file, 'utf8')); if (entry.pid) try { process.kill(-entry.pid, 'SIGKILL'); } catch {} }
  }
  admission.close();
}
