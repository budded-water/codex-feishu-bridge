// Explicit real-model fixture probe. It never connects to Feishu or a business project.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PilotAdmission } from '../dist/handoff/gateway.js';
import { NativeExecutions } from '../dist/handoff/native.js';
import { PilotInteractions } from '../dist/handoff/interactions.js';
import { CodexClient } from '../dist/codex/client.js';
import { verificationProfiles, fingerprint, verifyEngine } from '../dist/handoff/verification-profile.js';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw Error('Missing ' + name); return args[i + 1]; };
if (!args.includes('--native')) throw Error('Pass --native explicitly; this fixture consumes one Codex model turn.');
const engine = realpathSync(option('--engine')), revision = option('--revision'), output = option('--output');
const channel = option('--browser-channel');
if (!isAbsolute(output) || !/^[0-9a-f]{40}$/.test(revision) || !['chromium', 'chrome'].includes(channel)) throw Error('Invalid probe options');
process.umask(0o077);
mkdirSync(output, { recursive: true, mode: 0o700 });
const root = realpathSync(output); if (readdirSync(root).length) throw Error('Probe output must be empty');
const candidate = join(root, 'candidate'), workspace = join(root, 'workspace'); mkdirSync(workspace);
const pkg = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8'));
const profile = { projectRoot: root, projectId: 'prepared-web', suite: 'smoke', engineRoot: engine, engineRevision: revision,
  cliHash: fingerprint(readFileSync(join(engine, 'dist/cli.js'))), libraryHash: fingerprint(readFileSync(join(engine, 'dist/index.js'))), timeoutMs: 120_000 };
await verifyEngine(profile);
cpSync(join(engine, 'examples/prepared-web'), candidate, { recursive: true });
execFileSync(process.execPath, [join(engine, 'dist/cli.js'), 'init', '--route', '/', '--scenario', 'home', '--yes', '--project-root', candidate], { stdio: 'pipe', timeout: 30_000 });
const probe = createServer(); await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const projectFile = join(candidate, 'ui-eval/project.json'), project = JSON.parse(readFileSync(projectFile, 'utf8'));
project.projectId = 'prepared-web'; project.devServer = { command: process.execPath, args: ['server.mjs'], url: `http://127.0.0.1:${port}`, reuseExisting: false, startupTimeoutMs: 15_000 };
project.baseUrls.local = project.devServer.url; writeFileSync(projectFile, JSON.stringify(project));
const suiteFile = join(candidate, 'ui-eval/integrations/smoke.json'), suite = JSON.parse(readFileSync(suiteFile, 'utf8'));
suite.browserChannel = channel; writeFileSync(suiteFile, JSON.stringify(suite));
writeFileSync(join(candidate, 'ui-eval/engine.json'), JSON.stringify({ repository: pkg.repository.url, revision, bunVersion: pkg.packageManager.slice(4) }));
for (const argv of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', 'commit', '-qm', 'prepared verification fixture']]) execFileSync('git', ['-C', candidate, ...argv], { stdio: 'pipe' });
const policyPaths = execFileSync('git', ['-C', candidate, 'ls-files', '-z', 'ui-eval', 'check.mjs'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const policyFiles = Object.fromEntries(policyPaths.map(path => [path, fingerprint(readFileSync(join(candidate, path)))]));
const profiles = verificationProfiles({ fixture: { ...profile, projectRoot: candidate, policyFiles } });
const state = join(root, 'state');
const scope = { installation: 'verification-fixture', tenant: 'fixture', operator: 'fixture-owner', chat: 'fixture-chat', projects: { pilot: workspace },
  pilot: 'pilot', hubInstance: 'fixture-hub', source: 'fixture-source', rule: 'fixture-rule', agent: 'native', agentUse: 'bridge-native' };
const config = { accessMode: 'allowlist', allowedUsers: [scope.operator], allowedTenant: scope.tenant, enableGroups: false,
  groupContextMessages: 0, groupContextImages: 0, approvalUsers: [scope.operator], approvalChat: null,
  codexExecutable: option('--codex'), stateDirectory: state, approvalTimeoutSeconds: 300, projects: scope.projects, projectRouting: 'workspace' };
const admission = new PilotAdmission(state, scope, 'workspace');
const native = new NativeExecutions(admission, config, undefined, profiles), deliveries = [];
const sender = { send: async (_chat, text, id) => { deliveries.push({ id, text }); return 'fixture-' + id; } };
const reactions = { addReaction: async () => 'fixture-reaction', findReaction: async () => undefined, removeReaction: async () => {} };
const source = { flush: async () => {}, diagnose: async () => ({ status: 'missing' }) };
let gateway = new PilotInteractions(admission, config, source, native, sender, reactions, [], undefined, profiles);
const message = { tenant: scope.tenant, user: scope.operator, chat: scope.chat, id: randomUUID(), chatType: 'p2p',
  text: '/verify fixture 请只回复 P3_NATIVE_FIXTURE_READY，不调用工具、不修改文件。' };
let running;
const deadline = setTimeout(() => { void native.stop(); }, 180_000);
try {
  const admitted = gateway.receive(message); assert.ok('request' in admitted);
  const reserved = admission.store.reserve(admitted.request.id, 1); assert.equal(reserved.kind, 'start');
  running = native.run(reserved.permit); await running;
  for (let i = 0; i < 10; i++) await gateway.flush();
  const result = admission.store.verification(admitted.request.execution), report = native.evidence(admitted.request.execution);
  assert.equal(report.outcome.status, 'completed'); assert.equal(result.phase, 'observed'); assert.equal(result.observation.status, 'pass');
  const reader = new CodexClient(config.codexExecutable);
  let history;
  try { await reader.start(); history = await reader.request('thread/read', { threadId: report.outcome.thread, includeTurns: true }); }
  finally { await reader.close(); }
  const turn = history.thread.turns.find(item => item.id === report.outcome.turn);
  assert.equal(turn.status, 'completed'); assert.equal(history.thread.turns.length, 1);
  assert.deepEqual(turn.items.filter(item => item.type === 'agentMessage').map(item => item.text), ['P3_NATIVE_FIXTURE_READY']);
  assert.ok(turn.items.every(item => ['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(item.type)));
  assert.equal(result.observation.integration.conclusions.ui, 'pass'); assert.equal(result.observation.integration.conclusions.release, 'not-assessed');
  assert.equal(admission.store.unsettled().length, 0);
  assert.equal(deliveries.filter(x => x.text.includes('P3_NATIVE_FIXTURE_READY')).length, 1);
  assert.equal(deliveries.filter(x => x.text.includes('验证观测：pass')).length, 1);
  const journal = join(state, 'executions', admitted.request.execution, 'bridge.db'), journalHash = fingerprint(readFileSync(journal));
  await gateway.close(); gateway = new PilotInteractions(admission, config, source, native, sender, reactions, [], undefined, profiles);
  await gateway.start(); gateway.receive(message); for (let i = 0; i < 10; i++) await gateway.flush();
  assert.equal(fingerprint(readFileSync(journal)), journalHash);
  assert.equal(deliveries.filter(x => x.text.includes('P3_NATIVE_FIXTURE_READY')).length, 1);
  assert.equal(deliveries.filter(x => x.text.includes('验证观测：pass')).length, 1);
  const outcome = { phase: 'passed-isolated-native-ui-eval-handoff', execution: admitted.request.execution, nativeCheckpoint: report.checkpoint,
    engineRevision: revision, browserChannel: channel, verification: result, deliveries: deliveries.length,
    nativeTurnCount: history.thread.turns.length, nativeItemTypes: turn.items.map(item => item.type),
    restartAndDuplicatePreservedSingleHandoff: true, sealedJournalUnchanged: true, realFeishu: false, businessProject: false };
  writeFileSync(join(root, 'handoff-evidence.json'), JSON.stringify(outcome, null, 2) + '\n');
  console.log(JSON.stringify({ phase: outcome.phase, native: 'completed', verification: 'pass', ui: 'pass', release: 'not-assessed',
    restartAndDuplicatePreservedSingleHandoff: true, sealedJournalUnchanged: true, realFeishu: false, businessProject: false }));
} finally { clearTimeout(deadline); await native.stop(); await running?.catch(() => {}); await gateway.close(); admission.close(); }
