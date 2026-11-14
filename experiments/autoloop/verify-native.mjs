import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pinnedSource } from './pinned-source.mjs';
import { PilotAdmission, REQUEST_EVENT } from '../../dist/handoff/gateway.js';
import { FeishuAdmission } from '../../dist/channels/feishu-admission.js';
import { AutoloopSource, SourceOutbox } from '../../dist/handoff/source.js';
import { NativeExecutions } from '../../dist/handoff/native.js';
import { CodexClient } from '../../dist/codex/client.js';
import { normalizeMessage } from '../../dist/feishu.js';
import { PilotInteractions } from '../../dist/handoff/interactions.js';
import { loadConfig } from '../../dist/config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstream = pinnedSource(process.argv[2] ?? process.env.AUTOLOOP_SOURCE);
const native = process.argv.includes('--native');
const scratch = realpathSync(mkdtempSync('/tmp/assigned-native-'));
const home = join(scratch, 'home'), project = join(scratch, 'project'), state = join(scratch, 'state');
const auditFile = join(scratch, 'audit.jsonl');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(AGENT_AUTOLOOP_|HANDOFF_|BRIDGE_PROBE_|FEISHU_)/.test(name) && name !== 'NODE_TEST_CONTEXT'));
Object.assign(env, { AGENT_AUTOLOOP_HOME: home, SHELL: '/bin/sh', HANDOFF_RUNNER: join(root, 'dist/handoff/run-assignment.js') });
const cli = ['--disable-warning=ExperimentalWarning', join(upstream, 'bin/agent-autoloop.ts')];
let up, admission, runtime, reservation, interactions;
const deliveries = [];
const reactions = new Map();
const socketRoots = new Set();
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(label, inspect, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await inspect(); if (value) return value; await pause(50); }
  throw new Error('Timed out: ' + label);
}
async function stopUp(signal = 'SIGTERM') {
  if (!up || up.exitCode !== null || up.signalCode !== null) return;
  const done = new Promise(resolve => up.once('exit', resolve)); up.kill(signal); await done;
}
const audit = () => readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
try {
  process.umask(0o077);
  for (const directory of [home, project]) mkdirSync(directory, { mode: 0o700 });
  writeFileSync(auditFile, '');
  writeFileSync(join(home, 'rules.json'), JSON.stringify({
    sources: { fixture: { name: 'Fixture admission' } },
    agents: { native: { name: 'Assigned native executor', worker: 'fixture-worker', use: 'bridge-native', access: 'read', timeout: 2 } },
    channels: { fixture: { name: 'Synthetic human destination' } },
    rules: [{ name: 'pilot', to: 'native', cwd: project, group: 'pilot-project', parallel: 1, resume: false,
      when: { source: 'fixture', types: [REQUEST_EVENT] }, prompt: 'Dispatch metadata; task content belongs to admission state.', tell: 'always' }],
  }));
  const key = (kind, name) => {
    const result = spawnSync(process.execPath, [...cli, 'key', 'new', kind, name], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Cannot create fixture key'); return result.stdout.trim().split('\n').at(-1);
  };
  const ownerKey = key('owner', 'fixture-owner'), workerKey = key('worker', 'fixture-worker'), sourceKey = key('source', 'fixture');
  const plugin = join(home, 'plugins/bridge-native'); mkdirSync(plugin, { recursive: true });
  copyFileSync(join(root, 'experiments/autoloop/native-agent.ts'), join(plugin, 'agent.ts'));
  reservation = createServer();
  await new Promise((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const url = 'http://127.0.0.1:' + port;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ url, hub: { listen: '127.0.0.1:' + port }, worker: { name: 'fixture-worker', key: workerKey, capacity: 1 }, channels: {} }));
  const scope = { installation: 'fixture-installation', tenant: 'fixture-tenant', operator: 'ou_fixture_owner', chat: 'oc_fixture_chat',
    projects: { pilot: project }, pilot: 'pilot', hubInstance: 'fixture-hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const bridgeConfig = join(scratch, 'bridge.config.json');
  writeFileSync(bridgeConfig, JSON.stringify({ allowedUsers: [scope.operator, 'ou_fixture_admin'], allowedTenant: scope.tenant, enableGroups: false,
    approvalUsers: ['ou_fixture_admin'], approvalChat: 'oc_fixture_admin', codexExecutable: native ? 'codex' : process.execPath,
    stateDirectory: state, projects: scope.projects, projectRouting: 'workspace' }));
  const privateConfig = join(scratch, 'handoff.config.json');
  writeFileSync(privateConfig, JSON.stringify({ scope, stateDirectory: state, bridgeConfig, hubUrl: url }));
  Object.assign(env, { HANDOFF_CONFIG: privateConfig, HANDOFF_SOURCE_KEY: sourceKey,
    HANDOFF_CODEX_PREFIX: native ? '[]' : JSON.stringify([join(root, 'test/fixtures/codex-probe.mjs'), auditFile]) });
  admission = new PilotAdmission(state, scope, loadConfig(bridgeConfig).projectRouting);
  const ingress = new FeishuAdmission(admission, 'ou_fixture_bot');
  const outbox = new SourceOutbox(admission, new AutoloopSource(url, sourceKey));
  runtime = new NativeExecutions(admission, loadConfig(bridgeConfig));
  const openInteractions = (config = loadConfig(bridgeConfig)) => new PilotInteractions(admission, config, outbox, runtime, {
    send: async (chat, text, id, options) => { deliveries.push({ chat, text, id, options }); return 'fixture-reply-' + id; },
  }, {
    addReaction: async message => { reactions.set(message, 'fixture-reaction-' + message); return reactions.get(message); },
    findReaction: async message => reactions.get(message),
    removeReaction: async message => { reactions.delete(message); },
  }, [sourceKey]);
  interactions = openInteractions();
  await interactions.recover();
  const actor = (text, extra = {}) => ({ tenant: scope.tenant, user: scope.operator, chat: scope.chat, id: randomUUID(), text, ...extra });
  const raw = (id, text) => ({ tenant_key: scope.tenant, sender: { sender_type: 'user', sender_id: { open_id: scope.operator } },
    message: { message_id: id, chat_id: scope.chat, chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } });
  const start = () => { up = spawn(process.execPath, [...cli, 'up'], { env, stdio: 'ignore' }); };
  const ready = () => until('Hub ready', () => fetch(url + '/healthz').then(value => value.ok).catch(() => false));
  const hubState = async () => {
    const response = await fetch(url + '/v1/state', { headers: { authorization: 'Bearer ' + ownerKey }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); return response.json();
  };
  const submit = async (id, text) => {
    const value = interactions.receive(normalizeMessage(raw(id, text), 'ou_fixture_bot')); assert.equal(value.status, 'accepted');
    await interactions.flush(); await outbox.flush();
    assert.equal(admission.store.submission(value.request.id).status, 'scheduled');
    return value.request;
  };
  const ended = request => until('native result', async () => {
    await interactions.flush();
    const value = admission.store.execution(request.execution);
    return value && ['completed', 'interrupted', 'unknown'].includes(value.status) && value;
  }, native ? 180_000 : 30_000);
  const settledHub = () => until('worker receipts', async () => (await hubState()).runs.every(run => ['done', 'nothing', 'cancelled'].includes(run.state)));
  const inspect = async request => {
    const path = join(state, 'executions', request.execution, 'native-owner.json');
    if (!existsSync(path)) return;
    socketRoots.add(dirname(JSON.parse(readFileSync(path, 'utf8')).socket));
    try { const value = await runtime.inspect(request.execution); return value.turn && value; } catch { return; }
  };
  start(); await ready();
  if (native) {
    let thread;
    for (const id of ['native-first', 'native-followup']) {
      const request = await submit(id, 'Reply with exactly P1_NATIVE_OK. Do not call tools, read files, edit files, send messages or perform other actions.');
      assert.equal((await ended(request)).status, 'completed');
      const report = runtime.evidence(request.execution);
      if (thread) assert.equal(report.outcome.thread, thread); thread = report.outcome.thread;
      const db = new DatabaseSync(join(state, 'executions', request.execution, 'bridge.db'), { readOnly: true });
      try { assert.ok(db.prepare('SELECT body FROM outbox WHERE final=1').all().some(row => row.body.trim() === 'P1_NATIVE_OK')); }
      finally { db.close(); }
      console.log('PASS: ' + id + ' completed through actual Hub/Worker and native assignment runner');
    }
    await settledHub();
    const reader = new CodexClient();
    try {
      await reader.start();
      const history = await reader.request('thread/read', { threadId: thread, includeTurns: true });
      assert.equal(history.thread.turns.length, 2);
      const allowed = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan', 'contextCompaction']);
      assert.ok(history.thread.turns.every(turn => turn.items.every(item => allowed.has(item.type))));
    } finally { await reader.close(); }
    console.log('PASS: stored native history confirms two turns in one conversation with no tool execution items');
  } else {
    const first = await submit('first', 'pilot: case-hold');
    assert.equal(first.input, 'pilot: case-hold');
    await until('active native owner', () => inspect(first));
    assert.equal(audit().find(item => item.event === 'turn/start').text, first.input);
    assert.equal((await runtime.recover())[0].status, 'live');
    const queueConfig = { ...loadConfig(bridgeConfig), approvalUsers: [scope.operator], approvalChat: scope.chat };
    await interactions.close(); interactions = openInteractions(queueConfig); await interactions.recover();
    const withdrawn = await submit('withdrawn-queued', 'case-complete');
    const view = normalizeMessage(raw('queue-view', '/队列'), 'ou_fixture_bot');
    assert.equal(interactions.receive(view).status, 'queue'); await interactions.flush();
    assert.ok(deliveries.some(item => item.options?.replyTo === view.id && item.text.includes(withdrawn.execution)));
    const withdraw = normalizeMessage(raw('withdraw-exact', '/撤回 ' + withdrawn.execution), 'ou_fixture_bot');
    assert.equal(interactions.receive(withdraw).status, 'withdrawn'); await interactions.flush();
    assert.equal(admission.store.execution(withdrawn.execution), undefined);
    assert.equal(admission.store.unsettled()[0].id, first.execution);
    await interactions.close(); interactions = openInteractions(); await interactions.recover(); await interactions.flush();
    assert.equal(interactions.receive(withdraw).status, 'ignored');
    assert.equal(deliveries.filter(item => item.options?.replyTo === withdraw.id && item.text.includes('已撤回尚未开始')).length, 1);
    await stopUp('SIGKILL');
    assert.equal((await runtime.recover())[0].status, 'live');
    start(); await ready();
    const supplement = actor(' \t/补充 finish this fixture');
    const relay = runtime.relay.bind(runtime);
    runtime.relay = async (...args) => { const result = await relay(...args); throw new Error('Fixture acknowledgement lost after native dispatch: ' + result); };
    interactions.receive(supplement); await interactions.flush();
    assert.ok(['unknown', 'accepted'].includes(admission.store.control(supplement).status));
    await interactions.close(); interactions = openInteractions(); await interactions.recover();
    await interactions.flush();
    assert.equal(admission.store.control(supplement).status, 'accepted');
    assert.equal(interactions.receive(supplement).status, 'duplicate');
    runtime.relay = relay;
    assert.equal((await ended(first)).status, 'completed'); await settledHub();
    assert.equal(audit().filter(item => item.event === 'turn/start').length, 1);
    assert.equal(audit().filter(item => item.event === 'turn/steer').length, 1);
    assert.equal(admission.store.execution(withdrawn.execution), undefined);
    assert.equal(admission.store.withdrawals().length, 1);
    const withdrawalState = await hubState();
    const withdrawalRun = withdrawalState.runs.find(run => run.id === admission.store.assignmentRuns(withdrawn.id)[0]);
    // Early withdrawal can be observed before reservation, so bind via retained event when no assignment was recorded.
    const withdrawalEvent = admission.store.submission(withdrawn.id).event;
    const sourceOutcome = await new AutoloopSource(url, sourceKey).inspect(withdrawalEvent);
    assert.equal(sourceOutcome.runs[0].state, 'nothing');
    assert.ok(!withdrawalRun || withdrawalRun.state === 'nothing');
    assert.ok(!withdrawalState.cards.some(card => card.kind === 'ask' && card.run_id === sourceOutcome.runs[0].run));
    console.log('PASS: real queued Hub run survives exact owner withdrawal and worker restart without a native start or uncertainty question');
    const initial = runtime.evidence(first.execution);
    const next = await submit('followup', 'case-complete');
    await ended(next); await settledHub();
    assert.equal(runtime.evidence(next.execution).outcome.thread, initial.outcome.thread);
    const marker = JSON.parse(readFileSync(join(state, 'executions', first.execution, 'native-owner.json'), 'utf8'));
    await runtime.run(marker.permit);
    assert.equal(audit().filter(item => item.event === 'turn/start').length, 2);
    console.log('PASS: actual worker restart, duplicate live control, native continuation and retained checkpoint replay');

    const approval = await submit('approval', 'case-approval');
    let token;
    await until('native approval', async () => {
      await interactions.flush();
      token = deliveries.find(item => item.chat === 'oc_fixture_admin' && item.text.includes('/批准'))?.text.match(/请求 ([a-f0-9]{8})/)?.[1];
      return token;
    });
    interactions.receive(actor('/批准 ' + token)); await interactions.flush();
    assert.equal(audit().filter(item => item.event === 'decision').length, 0);
    const decision = actor(' \t/批准 ' + token, { user: 'ou_fixture_admin', chat: 'oc_fixture_admin' });
    interactions.receive(decision); assert.equal(interactions.receive(decision).status, 'duplicate'); await interactions.flush();
    await ended(approval); await settledHub();
    assert.equal(audit().filter(item => item.event === 'decision').length, 1);
    const stopping = await submit('stop', 'case-stop');
    await until('stoppable native turn', () => inspect(stopping));
    interactions.receive(actor('/stop')); await interactions.flush();
    assert.equal((await ended(stopping)).status, 'interrupted'); await settledHub();
    console.log('PASS: point-of-dispatch native approval ownership and observed interruption settlement');

    for (const mode of ['loss', 'lost-start', 'owner-loss']) {
      const before = audit().filter(item => item.event === 'turn/start').length;
      const request = await submit(mode, mode === 'owner-loss' ? 'case-hold' : 'case-' + mode);
      if (mode === 'owner-loss') {
        await until('owner ready for loss', () => inspect(request));
        const owner = JSON.parse(readFileSync(join(state, 'executions', request.execution, 'native-owner.json'), 'utf8'));
        process.kill(owner.pid, 'SIGKILL');
        await until('lost owner classified', async () => (await runtime.recover()).some(item => item.execution === request.execution && item.status === 'unknown'));
      }
      assert.equal((await ended(request)).status, 'unknown'); await settledHub();
      assert.equal(interactions.receive(normalizeMessage(raw('blocked-' + mode, 'more work'), 'ou_fixture_bot')).status, 'blocked');
      assert.equal(audit().filter(item => item.event === 'turn/start').length, before + 1);
      if (mode === 'loss') {
        const recoveryConfig = { ...loadConfig(bridgeConfig), approvalUsers: [scope.operator], approvalChat: scope.chat };
        await interactions.close(); interactions = openInteractions(recoveryConfig); await interactions.recover();
        interactions.receive(normalizeMessage(raw('inspect-' + mode, ' \t/恢复'), 'ou_fixture_bot')); await interactions.flush();
        await until('recovery inspection delivery', async () => { await interactions.flush(); return deliveries.some(item => item.text.includes('恢复编号：' + request.execution)); });
        const diagnostic = deliveries.find(item => item.text.includes('恢复编号：' + request.execution)).text;
        assert.ok(diagnostic.includes('Hub 调度轮次：已核实，已结束'));
        assert.ok(diagnostic.includes('原生进程：已核实退出'));
        assert.ok(diagnostic.includes('业务副作用：无法自动核实'));
        assert.ok(!diagnostic.includes(project) && !diagnostic.includes(sourceKey));
        const processEvidence = JSON.parse(readFileSync(join(state, 'executions', request.execution, 'native-processes.json'), 'utf8'));
        assert.ok(processEvidence.native && processEvidence.owner && processEvidence.observedAt > 0);
        const confirm = normalizeMessage(raw('recovery-' + mode, '/恢复 ' + request.execution + ' Inspected scripted fixture process exit and absence of external effects'), 'ou_fixture_bot');
        assert.equal(interactions.receive(confirm).status, 'recovery'); await interactions.flush();
        assert.equal(admission.store.unsettled().length, 0); assert.equal(admission.store.execution(request.execution).status, 'unknown');
        assert.ok(admission.store.recoveries().some(item => item.origin === JSON.stringify([scope.tenant, confirm.id]) && item.actor !== 'local-runtime-operator'));
        assert.equal(audit().filter(item => item.event === 'turn/start').length, before + 1);
        await interactions.close(); interactions = openInteractions(recoveryConfig); await interactions.recover(); await interactions.flush();
        assert.equal(interactions.receive(confirm).status, 'duplicate');
        await until('recovery confirmation delivery', async () => { await interactions.flush(); return deliveries.some(item => item.options?.replyTo === confirm.id && item.text.includes('解除该任务')); });
        assert.equal(deliveries.filter(item => item.options?.replyTo === confirm.id && item.text.includes('解除该任务')).length, 1);
        await interactions.close(); interactions = openInteractions(); await interactions.recover();
        console.log('PASS: owner-private inspected recovery through actual Hub/Worker retains uncertainty, deduplicates its receipt and never replays native work');
      } else ingress.reconcile(raw('recovery-' + mode, '/reconcile ' + request.execution), { execution: request.execution, processSettled: true, effectsChecked: true,
        reference: 'Inspected scripted fixture process loss and absence of external effects' });
    }
    assert.ok(audit().filter(item => item.event === 'initialize').every(item => item.schedulerSecrets === false));
    assert.ok(audit().filter(item => ['thread/start', 'thread/resume'].includes(item.event)).every(item => item.workspaceMode === true));
    console.log('PASS: app-server loss, lost native start acknowledgement and owner-process loss retain project guards');
  }
  for (let i = 0; i < 10; i++) await interactions.flush();
  assert.equal(new Set(deliveries.map(item => item.id)).size, deliveries.length, 'Delivered native UUID must not be recreated');
  assert.equal(reactions.size, 0, 'Terminal tasks clean their owned reactions');
  if (native) assert.equal(deliveries.filter(item => item.text.trim() === 'P1_NATIVE_OK').length, 2);
  console.log('PASS: durable gateway controls, full native prompt/final delivery and independent reaction cleanup');
  console.log('Scope: real Hub/Worker, native execution, gateway relay and synthetic human transport; no Feishu connection.');
} finally {
  await stopUp();
  const runs = join(home, 'worker/runs');
  if (existsSync(runs)) for (const name of readdirSync(runs)) {
    const path = join(runs, name, 'entry.json');
    if (existsSync(path)) {
      const { pid } = JSON.parse(readFileSync(path, 'utf8'));
      if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    }
  }
  await interactions?.close();
  admission?.close();
  for (const path of socketRoots) rmSync(path, { recursive: true, force: true });
  reservation?.close();
  rmSync(scratch, { recursive: true, force: true });
}
