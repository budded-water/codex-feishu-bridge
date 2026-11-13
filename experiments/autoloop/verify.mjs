// Explicit integration acceptance: pinned upstream Hub + Worker, scripted Codex RPC, synthetic channel.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import plugin from './agent.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const native = process.argv.includes('--native');
const source = realpathSync(process.argv[2] ?? process.env.AUTOLOOP_SOURCE ?? '');
const pin = JSON.parse(readFileSync(join(root, 'experiments/autoloop/source.json'), 'utf8'));
const git = args => {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Autoloop must be a verified Git checkout');
  return result.stdout.trim();
};
assert.equal(git(['rev-parse', 'HEAD']), pin.commit, 'Autoloop checkout does not match reviewed pin');
assert.equal(git(['status', '--porcelain']), '', 'Autoloop checkout must be clean, including untracked files');
assert.equal(git(['remote', 'get-url', 'origin']).replace(/\.git$/, ''), pin.repository.replace(/\.git$/, ''));
assert.ok(existsSync(join(root, 'dist/probes/autoloop-runner.js')), 'Run npm run build first');
const cli = join(source, 'bin/agent-autoloop.ts');
const scratch = realpathSync(mkdtempSync('/tmp/bridge-autoloop-p0-'));
const home = join(scratch, 'home');
const workspace = join(scratch, 'workspace');
mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
const auditFile = join(scratch, 'native-audit.jsonl');
writeFileSync(auditFile, '', { mode: 0o600 });
const token = randomUUID();
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(AGENT_AUTOLOOP_|BRIDGE_PROBE_|FEISHU_)/.test(name) && name !== 'NODE_TEST_CONTEXT'));
Object.assign(env, {
  AGENT_AUTOLOOP_HOME: home, SHELL: '/bin/sh', BRIDGE_PROBE_CONTROL_TOKEN: token,
  BRIDGE_PROBE_RUNNER: join(root, 'dist/probes/autoloop-runner.js'),
  BRIDGE_PROBE_CODEX: native ? 'codex' : process.execPath,
  BRIDGE_PROBE_CODEX_PREFIX: native ? '[]' : JSON.stringify([join(root, 'test/fixtures/codex-probe.mjs'), auditFile]),
});
const cliArgs = ['--disable-warning=ExperimentalWarning', cli];
const key = (kind, name) => {
  const result = spawnSync(process.execPath, [...cliArgs, 'key', 'new', kind, name], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Cannot create isolated fixture key');
  return result.stdout.trim().split('\n').at(-1);
};
const pluginDir = join(home, 'plugins/bridge-probe'); mkdirSync(pluginDir, { recursive: true });
copyFileSync(join(root, 'experiments/autoloop/agent.ts'), join(pluginDir, 'agent.ts'));
writeFileSync(join(home, 'rules.json'), JSON.stringify({
  sources: { probe: { name: 'Synthetic P0 source' } },
  // The pinned kernel expresses this timeout in minutes.
  agents: { probe: { name: 'P0 fixture', worker: 'probe-worker', use: 'bridge-probe', access: 'read', timeout: 2 } },
  channels: { fixture: { name: 'Synthetic channel; no adapter' } },
  rules: [{ name: 'probe', when: { source: 'probe', types: ['probe.*'] }, to: 'probe', cwd: workspace,
    prompt: native ? 'Bounded native model acceptance. Reply with exactly P0_NATIVE_OK. Do not call tools, read files, edit anything, send messages or take other actions. No scheduler receipt is needed.' : 'P0 protocol fixture only.',
    resume: true, tell: 'always' }],
}));
const owner = key('owner', 'probe-owner');
const worker = key('worker', 'probe-worker');
const sourceKey = key('source', 'probe');
async function listen(server) {
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  return server.address().port;
}
const portReservation = createServer();
const hubPort = await listen(portReservation);
await new Promise(done => portReservation.close(done));
const hub = 'http://127.0.0.1:' + hubPort;
const posts = new Map();
const dropped = new Set();
// Forward, then lose the acknowledgement: the Hub may have committed the operation already.
const proxy = createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const target = new URL(request.url, hub);
    if (/\/runs\/\d+\/(started|result)$/.test(target.pathname)) posts.set(target.pathname, (posts.get(target.pathname) ?? 0) + 1);
    const remote = await fetch(target, { method: request.method, headers: { authorization: request.headers.authorization ?? '', 'content-type': 'application/json' },
      ...(body.length && { body }), signal: AbortSignal.timeout(60_000) });
    const text = await remote.text();
    const kind = target.pathname.split('/').at(-1);
    if (['started', 'result'].includes(kind) && remote.ok && !dropped.has(kind)) {
      dropped.add(kind); response.writeHead(503).end('{"error":"fixture acknowledgement loss"}');
    } else response.writeHead(remote.status, { 'content-type': 'application/json' }).end(text);
  } catch { response.writeHead(503).end('{}'); }
});
const proxyPort = await listen(proxy);
writeFileSync(join(home, 'config.json'), JSON.stringify({
  url: 'http://127.0.0.1:' + proxyPort, hub: { listen: '127.0.0.1:' + hubPort },
  worker: { name: 'probe-worker', key: worker }, channels: {},
}));
let up;
const controls = new Set();
function start() {
  up = spawn(process.execPath, [...cliArgs, 'up'], { env, stdio: 'ignore' });
}
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(label, read, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await read(); if (found) return found;
    await pause(50);
  }
  throw new Error('Timed out: ' + label);
}
async function request(path, body, credential = owner) {
  const result = await fetch(hub + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  assert.equal(result.status, 200, 'Fixture API rejected ' + path);
  return result.json();
}
const audit = () => readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const starts = () => audit().filter(item => item.event === 'turn/start');
const executionFolder = run => join(home, 'bridge-probe-executions', String(run));
async function control(run, text, actor = {}, suppliedToken = token) {
  const descriptor = join(executionFolder(run), 'control.json');
  await until('private control descriptor', () => existsSync(descriptor));
  const { socket } = JSON.parse(readFileSync(descriptor, 'utf8')); controls.add(dirname(socket));
  return new Promise((done, fail) => {
    const client = connect(socket); let received = '';
    client.setTimeout(2000, () => client.destroy(new Error('Control timeout')));
    client.once('error', fail);
    client.on('data', chunk => { received += chunk; });
    client.once('end', () => { try { done(JSON.parse(received)); } catch (error) { fail(error); } });
    client.once('connect', () => client.end(JSON.stringify({ token: suppliedToken, ...(text && { message: {
      tenant: 'probe-tenant', user: 'probe-owner', chat: 'probe-chat', id: randomUUID(), text, ...actor,
    } }) }) + '\n'));
  });
}
async function event(id, subject) {
  const before = (await request('/v1/state')).runs.map(run => run.id);
  await request('/v1/events', { id, type: 'probe.test', subject, summary: 'Synthetic protocol exercise' }, sourceKey);
  return until('assigned run', async () => (await request('/v1/state')).runs.find(run => !before.includes(run.id)));
}
const ended = run => until('terminal run ' + run, async () => {
  const value = (await request('/v1/state')).runs.find(item => item.id === run);
  return value && ['done', 'nothing', 'cancelled'].includes(value.state) && value;
}, native ? 180_000 : 30_000);
async function stopUp(signal = 'SIGTERM') {
  if (!up || up.exitCode !== null || up.signalCode !== null) return;
  const exited = new Promise(done => up.once('exit', done)); up.kill(signal); await exited;
}
const passed = [];
try {
  start();
  await until('hub ready', () => fetch(hub + '/healthz').then(result => result.ok).catch(() => false));
  if (native) {
    let thread;
    let previousTurn;
    for (const id of ['native-first', 'native-continuation']) {
      const run = await event(id, 'bounded-native-text');
      const terminal = await ended(run.id);
      assert.match(terminal.summary, /round completed/);
      const db = new DatabaseSync(join(executionFolder(run.id), 'bridge.db'), { readOnly: true });
      try {
        const execution = db.prepare('SELECT tasks.turn, tasks.status, sessions.thread FROM tasks JOIN sessions ON sessions.id=tasks.session').get();
        assert.equal(execution.status, 'completed');
        assert.ok(execution.thread && execution.turn);
        if (thread) assert.equal(execution.thread, thread);
        if (previousTurn) assert.notEqual(execution.turn, previousTurn);
        thread = execution.thread; previousTurn = execution.turn;
        assert.ok(db.prepare('SELECT body FROM outbox WHERE final=1').all().some(row => row.body.trim() === 'P0_NATIVE_OK'));
      } finally { db.close(); }
      console.log('PASS: ' + id + ' completed with the exact fixed reply');
    }
    const { CodexClient } = await import('../../dist/codex/client.js');
    const reader = new CodexClient();
    try {
      await reader.start();
      const history = await reader.request('thread/read', { threadId: thread, includeTurns: true });
      assert.equal(history.thread.turns.length, 2, 'Exactly two native turns, without hidden replay');
      const allowed = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan', 'contextCompaction']);
      assert.ok(history.thread.turns.every(turn => turn.items.every(item => allowed.has(item.type))), 'Bounded native acceptance must contain no tool execution items');
    } finally { await reader.close(); }
    console.log('PASS: stored native history confirms exactly two turns and no tool execution items');
    console.log('Scope: real native Codex model access and same-thread continuation through pinned Autoloop; no Feishu or deployment.');
  } else {
  const first = await event('event-hold', 'case-hold');
  await until('first native turn', () => starts().length === 1);
  const original = starts()[0];
  await until('native session published', async () => (await request('/v1/state')).runs.find(run => run.id === first.id)?.session === original.thread);
  assert.ok((await control(first.id, undefined, {}, 'wrong-token')).error);
  await control(first.id, '/stop', { user: 'another-owner' });
  await control(first.id, '/补充 wrong chat', { chat: 'another-chat' });
  assert.equal(audit().filter(item => ['turn/interrupt', 'turn/steer'].includes(item.event)).length, 0);
  assert.equal((await control(first.id, '/status')).execution.status, 'running');
  await stopUp('SIGKILL');
  process.kill(original.pid, 0); // Losing Hub/Worker did not terminate the detached native owner.
  start();
  await until('hub restart', () => fetch(hub + '/healthz').then(result => result.ok).catch(() => false));
  await control(first.id, '/补充 finish this fixture');
  const finished = await ended(first.id);
  assert.equal(finished.session, original.thread);
  assert.equal(starts().length, 1);
  await until('result acknowledgement retried', () => (posts.get('/v1/runs/' + first.id + '/result') ?? 0) >= 2);
  assert.equal(starts().length, 1);
  assert.equal(dropped.size, 2);
  passed.push('worker restart + lost started/result acknowledgements retain one native turn');

  // A retry gets a different attempt folder. It must still read the same execution database.
  const retryFolder = join(scratch, 'another-attempt'); mkdirSync(retryFolder);
  const retry = spawnSync(process.execPath, [env.BRIDGE_PROBE_RUNNER, JSON.stringify({ folder: retryFolder, cwd: workspace, prompt: 'Do not replay', resume: null })],
    { env: { ...env, AGENT_AUTOLOOP_RUN: String(first.id) }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(retry.status, 0);
  assert.match(plugin.read(retry.stdout, retry.status).text, /round completed/);
  assert.equal(starts().length, 1);
  const next = await event('event-next', 'case-complete');
  const continued = await ended(next.id);
  assert.equal(continued.session, original.thread);
  assert.equal(starts()[1].thread, original.thread);
  assert.notEqual(starts()[1].turn, original.turn);
  await request('/v1/events', { id: 'event-next', type: 'probe.test', subject: 'case-complete', summary: 'Duplicate event' }, sourceKey);
  await pause(200);
  assert.equal(starts().length, 2);
  passed.push('same-thread continuation, event deduplication and changed-attempt receipt replay');

  const approval = await event('event-approval', 'case-approval');
  let approvalToken;
  await until('native approval delivered to synthetic admin', async () => {
    const seen = await control(approval.id);
    approvalToken = seen.messages.find(item => item.chat === 'probe-admin-chat')?.body.match(/请求 ([a-f0-9]{8})/)?.[1];
    return approvalToken;
  });
  await control(approval.id, '/批准 ' + approvalToken);
  assert.equal(audit().filter(item => item.event === 'decision').length, 0);
  await control(approval.id, '/批准 ' + approvalToken, { user: 'probe-admin', chat: 'probe-admin-chat' });
  await ended(approval.id);
  assert.equal(audit().filter(item => item.event === 'decision').length, 1);
  passed.push('native approval uses designated actor/chat, independently of business receipts');

  const stopping = await event('event-stop', 'case-stop');
  await until('stoppable turn', async () => (await control(stopping.id)).execution?.turn);
  const interrupt = await control(stopping.id, '/stop');
  assert.equal(interrupt.execution.status, 'running', 'Interrupt acknowledgement is not terminal');
  assert.equal((await ended(stopping.id)).state, 'nothing');
  passed.push('native stop waits for observed terminal notification');

  for (const mode of ['lost-start', 'loss']) {
    const before = starts().length;
    const lost = await event('event-' + mode, 'case-' + mode);
    const terminal = await ended(lost.id);
    assert.match(terminal.summary, /requires reconciliation/);
    assert.equal(starts().length, before + 1);
    const retry = spawnSync(process.execPath, [env.BRIDGE_PROBE_RUNNER, JSON.stringify({ folder: retryFolder, cwd: workspace, prompt: 'Do not replay', resume: null })],
      { env: { ...env, AGENT_AUTOLOOP_RUN: String(lost.id) }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(retry.status, 0);
    assert.match(plugin.read(retry.stdout, retry.status).text, /requires reconciliation/);
    assert.equal(starts().length, before + 1);
  }
  passed.push('accepted start without acknowledgement and app-server loss stay uncertain without native replay');

  const cancelled = await event('event-group-cancel', 'case-group-cancel');
  await until('native process for group cancellation', () => starts().find(item => item.mode === 'group-cancel'));
  const native = starts().find(item => item.mode === 'group-cancel');
  await control(cancelled.id); // Track its fixture socket for forced-kill cleanup.
  await request('/v1/runs/' + cancelled.id + '/cancel', {});
  assert.equal((await ended(cancelled.id)).state, 'cancelled');
  assert.throws(() => process.kill(native.pid, 0), { code: 'ESRCH' });
  assert.ok(audit().filter(item => item.event === 'initialize').every(item => item.schedulerSecrets === false));
  passed.push('worker cancellation settles the owned process group; native child receives no scheduler secrets');
  for (const line of passed) console.log('PASS: ' + line);
  console.log('Scope: pinned real Autoloop + scripted Codex protocol; no model inference, Feishu messages or deployment.');
  }
} finally {
  await stopUp();
  // CLI up intentionally leaves detached runs alive; clean only groups identified in this fixture's own entries.
  const runs = join(home, 'worker/runs');
  if (existsSync(runs)) for (const name of readdirSync(runs)) {
    const entry = join(runs, name, 'entry.json');
    if (!existsSync(entry)) continue;
    const { pid } = JSON.parse(readFileSync(entry, 'utf8'));
    if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
  }
  proxy.closeAllConnections();
  await new Promise(done => proxy.close(done));
  for (const directory of controls) rmSync(directory, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}
