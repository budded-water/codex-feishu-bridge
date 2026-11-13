// P1 feasibility only: actual pinned Hub/public HTTP; synthetic worker, no native agent or Feishu.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pinnedSource } from './pinned-source.mjs';

const source = pinnedSource(process.argv[2] ?? process.env.AUTOLOOP_SOURCE);
process.umask(0o077);
const scratch = mkdtempSync('/tmp/bridge-handoff-routing-');
const home = join(scratch, 'home');
const alpha = join(scratch, 'alpha');
const beta = join(scratch, 'beta');
const env = { PATH: process.env.PATH, HOME: process.env.HOME, AGENT_AUTOLOOP_HOME: home };
const cli = ['--disable-warning=ExperimentalWarning', join(source, 'bin/agent-autoloop.ts')];
let up;
let reservation;
try {
  for (const directory of [home, alpha, beta]) mkdirSync(directory, { mode: 0o700 });
  const agent = name => ({ name, worker: 'fixture-worker', use: 'command', command: [process.execPath, '-e', 'process.exit(99)'] });
  const rule = (name, to, cwd, extra) => ({ name, to, cwd, when: { source: 'fixture', types: ['request.' + name] }, tell: 'never', ...extra });
  writeFileSync(join(home, 'rules.json'), JSON.stringify({
    sources: { fixture: { name: 'Synthetic source' } },
    agents: { baseline: agent('baseline'), native: agent('native') },
    channels: {},
    rules: [
      rule('baseline', 'baseline', alpha, { resume: true }),
      rule('alpha', 'native', alpha, { group: 'project-alpha', parallel: 1, resume: false }),
      rule('alpha-alias', 'native', alpha, { group: 'project-alpha', parallel: 1, resume: false }),
      rule('beta', 'native', beta, { group: 'project-beta', parallel: 1, resume: false }),
    ],
  }));
  const key = kind => {
    const result = spawnSync(process.execPath, [...cli, 'key', 'new', kind, kind === 'worker' ? 'fixture-worker' : kind === 'source' ? 'fixture' : 'fixture-owner'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, 'Cannot create isolated fixture key');
    return result.stdout.trim().split('\n').at(-1);
  };
  const owner = key('owner'), worker = key('worker'), sourceKey = key('source');
  reservation = createServer();
  await new Promise((done, fail) => { reservation.once('error', fail); reservation.listen(0, '127.0.0.1', done); });
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const url = 'http://127.0.0.1:' + port;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ url, hub: { listen: '127.0.0.1:' + port }, channels: {} }));
  up = spawn(process.execPath, [...cli, 'up'], { env, stdio: 'ignore' });
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (await fetch(url + '/healthz').then(result => result.ok).catch(() => false)) break;
    assert.ok(Date.now() < deadline, 'Isolated Hub did not start');
    await new Promise(done => setTimeout(done, 50));
  }
  async function request(path, credential = owner, body) {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, 'Fixture API rejected ' + path);
    return response.json();
  }
  const event = (id, type, subject = id) => request('/v1/events', sourceKey, { id, type: 'request.' + type, subject, summary: 'Synthetic request' });
  const outcome = id => request('/v1/events/' + id, sourceKey);
  const active = new Set();
  const claim = id => request('/v1/work?' + new URLSearchParams({ claim: id, wait: '0', running: [...active].join(','), capacity: '1' }), worker);
  const finish = async (job, session = randomUUID()) => {
    await request('/v1/runs/' + job.run + '/result', job.token, { outcome: 'done', summary: 'Synthetic completion; no native execution', session });
    active.delete(job.run);
  };
  const select = async () => {
    const { job } = await claim(randomUUID());
    assert.ok(job, 'Expected a dispatchable request');
    active.add(job.run);
    return job;
  };

  // Negative control: show that the default lane actually merges different source events.
  const baselineA = await event('baseline-a', 'baseline', 'owner-a');
  const baselineB = await event('baseline-b', 'baseline', 'owner-b');
  assert.equal((await outcome(baselineA.event)).runs[0].run, (await outcome(baselineB.event)).runs[0].run);
  const combined = await select();
  assert.equal(combined.context.events.length, 2);
  const inherited = randomUUID(); await finish(combined, inherited);
  await event('baseline-c', 'baseline', 'owner-c');
  const baselineNext = await select();
  assert.equal(baselineNext.session, inherited);
  await finish(baselineNext);
  console.log('PASS: negative control demonstrates default-lane coalescing and same-lane session inheritance');

  const firstEvent = await event('alpha-a', 'alpha');
  const secondEvent = await event('alpha-b', 'alpha');
  const aliasEvent = await event('alpha-c', 'alpha-alias');
  const duplicate = await event('alpha-a', 'alpha');
  assert.equal(duplicate.duplicate, true);
  const ids = await Promise.all([firstEvent, secondEvent, aliasEvent].map(async value => (await outcome(value.event)).runs[0].run));
  assert.equal(new Set(ids).size, 3, 'Burst requests must retain separate scheduling runs');
  const claimId = randomUUID();
  let first = (await claim(claimId)).job;
  assert.ok(first); active.add(first.run);
  assert.equal(first.context.events.length, 1);
  const again = (await claim(claimId)).job;
  assert.equal(again.run, first.run, 'A lost claim response must not claim another run');
  first = again; // The retained claim returns the current attempt credential.
  assert.equal((await claim(randomUUID())).job, null, 'Same-project requests and aliases must wait');

  await event('beta-a', 'beta');
  const independent = await select();
  assert.equal(independent.rule.name, 'beta', 'Another project remains independently dispatchable');
  const previousSession = randomUUID(); await finish(independent, previousSession);
  // Deliberately reuse a lane: the pilot rejects this input, but the kernel flag must still prevent inheritance.
  await event('beta-b', 'beta', 'beta-a');
  const fresh = await select();
  assert.equal(fresh.session, null, 'resume:false must not inherit even a reused lane session');
  await finish(fresh);
  await finish(first);
  const second = await select();
  assert.equal(second.rule.name, 'alpha');
  assert.equal(second.context.events.length, 1);
  assert.equal((await claim(randomUUID())).job, null);
  await finish(second);
  const alias = await select();
  assert.equal(alias.agent.id, 'native');
  assert.equal(alias.rule.name, 'alpha-alias');
  assert.equal(alias.context.events.length, 1);
  await finish(alias);
  console.log('PASS: distinct request lanes, source deduplication, lost-claim lookup and canonical project-group serialization');
  console.log('PASS: independent projects remain dispatchable; resume:false prevents scheduler session inheritance');

  await request('/v1/rules/alpha/pause', owner, { reason: 'Synthetic admission check' });
  const paused = await event('alpha-paused', 'alpha');
  assert.deepEqual(paused.routed, []);
  assert.deepEqual(paused.paused, ['alpha']);
  const retained = await outcome(paused.event);
  assert.deepEqual(retained.runs, []);
  assert.deepEqual(retained.paused, ['alpha']);
  assert.equal((await claim(randomUUID())).job, null);
  console.log('PASS: paused source events are retained as skipped, not scheduled; source outcome exposes the distinction');
  assert.ok((await request('/v1/state')).runs.every(run => run.state === 'done'));
  console.log('Scope: pinned Hub/public HTTP and synthetic worker only; no gateway implementation, native model, Feishu, service change or cutover.');
} finally {
  if (up && up.exitCode === null && up.signalCode === null) {
    const exited = new Promise(done => up.once('exit', done));
    up.kill('SIGTERM'); await exited;
  }
  reservation?.close();
  rmSync(scratch, { recursive: true, force: true });
}
