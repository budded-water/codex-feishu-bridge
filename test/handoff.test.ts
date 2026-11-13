import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Worker } from 'node:worker_threads';
import { FeishuAdmission } from '../src/channels/feishu-admission.js';
import { PilotAdmission, REQUEST_EVENT, type PilotScope } from '../src/handoff/gateway.js';
import { AutoloopSource, SourceOutbox } from '../src/handoff/source.js';

function event(id: string, text = 'Inspect the project', changes: { user?: string; tenant?: string; chat?: string; type?: string } = {}) {
  return { tenant_key: changes.tenant ?? 'fixture-tenant',
    sender: { sender_type: 'user', sender_id: { open_id: changes.user ?? 'ou_fixture_owner' } },
    message: { message_id: id, chat_id: changes.chat ?? 'fixture-chat', chat_type: changes.type ?? 'p2p', message_type: 'text', content: JSON.stringify({ text }) } };
}

function setup(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-test-')));
  const project = join(root, 'project'); const other = join(root, 'other');
  mkdirSync(project); mkdirSync(other); symlinkSync(project, join(root, 'alias'));
  const scope: PilotScope = { installation: 'fixture-installation', tenant: 'fixture-tenant', operator: 'ou_fixture_owner', chat: 'fixture-chat',
    projects: { pilot: project, alias: join(root, 'alias'), other }, pilot: 'pilot', hubInstance: 'fixture-hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const state = join(root, 'state');
  const gateway = new PilotAdmission(state, scope);
  const ingress = new FeishuAdmission(gateway, 'ou_fixture_bot');
  const opened = [gateway];
  const reopen = () => { const next = new PilotAdmission(state, scope); opened.push(next); return next; };
  t.after(() => { for (const item of opened) item.close(); rmSync(root, { recursive: true, force: true }); });
  const accept = (id: string, text?: string) => {
    const result = ingress.receive(event(id, text));
    assert.ok('request' in result);
    return result.request;
  };
  const job = (id: string, run = 1) => ({ run, attempt: 1, session: 'untrusted-scheduler-session', rule: { name: scope.rule, cwd: project },
    agent: { id: scope.agent, use: scope.agentUse }, context: { events: [{ id, subject: id, source: scope.source, type: REQUEST_EVENT }], answers: [], timers: [] } });
  return { root, state, gateway, ingress, scope, accept, job, reopen };
}

test('verified input, immutable identity and source intent persist through reopen and alias changes', t => {
  const h = setup(t);
  for (const changes of [{ user: 'ou_other' }, { tenant: 'other' }, { chat: 'other' }, { type: 'group' }]) assert.equal(h.ingress.receive(event('ignored', undefined, changes)).status, 'ignored');
  assert.equal(h.ingress.receive(event('control', '/批准 stale')).status, 'rejected');
  assert.equal(h.ingress.receive(event('outside', 'other: work')).status, 'rejected');
  const first = h.accept('first', 'alias: Preserve this task');
  const original = h.ingress.receive(event('first', 'different redelivered content'));
  assert.ok('request' in original);
  assert.equal(original.status, 'duplicate');
  assert.equal(original.request.input, 'Preserve this task');
  assert.equal(original.request.id, first.id);
  const next = h.accept('next');
  assert.equal(next.conversation, first.conversation);
  assert.notEqual(next.execution, first.execution);
  const reopened = h.reopen();
  const ingress = new FeishuAdmission(reopened, 'ou_fixture_bot');
  assert.equal(ingress.receive(event('first')).status, 'duplicate');
  assert.throws(() => new FeishuAdmission(reopened, 'ou_different_bot'), /identity/);
  assert.equal(reopened.store.request(first.id)!.execution, first.execution);
  assert.equal(reopened.store.pending().length, 2);
  assert.equal(statSync(h.state).mode & 0o777, 0o700);
  assert.equal(statSync(join(h.state, 'handoff.db')).mode & 0o777, 0o600);
  const titled = h.accept('titled', 'Note: inspect the pilot');
  assert.equal(titled.input, 'Note: inspect the pilot');
  assert.throws(() => new PilotAdmission(h.state, { ...h.scope, hubInstance: 'another-hub' }), /another installation/);
});

test('assignment fields and mixed event contexts cannot change admitted authority', t => {
  const h = setup(t); const request = h.accept('first');
  const original = h.job(request.id);
  for (const value of [
    { ...original, run: 0 }, { ...original, rule: { ...original.rule, cwd: h.root } },
    { ...original, agent: { ...original.agent, id: 'other' } },
    { ...original, context: { ...original.context, events: [] } },
    { ...original, context: { ...original.context, events: [...original.context.events, ...original.context.events] } },
    { ...original, context: { ...original.context, answers: [{}] } },
    { ...original, context: { ...original.context, events: [{ ...original.context.events[0], source: 'other' }] } },
  ]) assert.throws(() => h.gateway.assignment(value));
  assert.equal(h.gateway.assignment(original).request.execution, request.execution);
  assert.equal(h.gateway.store.unsettled().length, 0);
});

test('uncertainty holds a project across aliases, queued work, restarts and duplicate runs', t => {
  const h = setup(t);
  const first = h.accept('first'); const queued = h.accept('queued', 'alias: next');
  const reserved = h.gateway.store.reserve(first.id, 1); assert.equal(reserved.kind, 'start');
  if (reserved.kind !== 'start') return;
  const during = h.accept('during'); // Active work permits queue admission.
  assert.equal(during.blocked, null);
  assert.equal(h.gateway.store.reserve(queued.id, 2).kind, 'busy');
  assert.throws(() => h.gateway.uncertain({ ...reserved.permit, token: 'wrong' }, 'start_unconfirmed'), /owner/);
  h.gateway.uncertain(reserved.permit, 'start_unconfirmed');
  const reopened = h.reopen();
  const ingress = new FeishuAdmission(reopened, 'ou_fixture_bot');
  assert.equal(reopened.store.unsettled()[0]!.status, 'unknown');
  assert.equal(reopened.store.reserve(first.id, 7).kind, 'existing');
  assert.equal(reopened.store.reserve(queued.id, 2).kind, 'blocked');
  const later = ingress.receive(event('later', 'alias: more work')); assert.equal(later.status, 'blocked');
  assert.throws(() => reopened.terminal(reserved.permit, { status: 'completed', processSettled: false as never, reference: 'late-report' }), /evidence/);
  const proof = { execution: first.execution, processSettled: true as const, effectsChecked: true as const, reference: 'fixture inspection of native journal and project effects' };
  assert.throws(() => ingress.reconcile(event('first', '/reconcile ' + first.execution), proof), /identity/);
  assert.throws(() => ingress.reconcile(event('recover', '/reconcile ' + first.execution, { user: 'ou_other' }), proof));
  ingress.reconcile(event('recover', '/reconcile ' + first.execution), proof);
  assert.equal(reopened.store.unsettled().length, 0);
  assert.equal(reopened.store.reserve(queued.id, 2).kind, 'blocked', 'A held old request does not gain fresh authorization');
  const fresh = ingress.receive(event('remaining', 'Perform only the remaining authorized work')); assert.ok('request' in fresh);
  const freshPermit = reopened.store.reserve(fresh.request.id, 8); assert.equal(freshPermit.kind, 'start');
  ingress.reconcile(event('recover', '/reconcile ' + first.execution), proof);
  assert.equal(reopened.store.unsettled()[0]!.id, fresh.request.execution, 'Duplicate old recovery cannot clear a newer guard');
  assert.equal(reopened.store.reserve(first.id, 9).kind, 'existing');
});

test('terminal evidence is idempotent, owner-bound and cannot release newer work', t => {
  const h = setup(t); const request = h.accept('first');
  const start = h.gateway.store.reserve(request.id, 1); assert.equal(start.kind, 'start');
  if (start.kind !== 'start') return;
  const evidence = { status: 'completed' as const, processSettled: true as const, reference: 'execution-state/terminal-version' };
  h.gateway.uncertain(start.permit, 'completion_unconfirmed');
  h.gateway.terminal(start.permit, evidence);
  h.gateway.terminal(start.permit, evidence);
  assert.equal(h.gateway.uncertain(start.permit, 'completion_unconfirmed').status, 'completed');
  assert.throws(() => h.gateway.terminal(start.permit, { ...evidence, status: 'interrupted' }), /Conflicting/);
  const next = h.accept('next'); assert.equal(h.gateway.store.reserve(next.id, 2).kind, 'start');
  h.gateway.terminal(start.permit, evidence);
  assert.equal(h.gateway.store.unsettled()[0]!.id, next.execution);
});

test('two simultaneous database owners admit one execution for a canonical project', async t => {
  const h = setup(t); const requests = [h.accept('one'), h.accept('two', 'alias: two')];
  const barrier = new SharedArrayBuffer(4); const gate = new Int32Array(barrier);
  const workers = requests.map((request, index) => new Worker(new URL('./fixtures/admission-worker.mjs', import.meta.url), {
    execArgv: ['--import', 'tsx'], workerData: { state: h.state, scope: h.scope, request: request.id, run: index + 1, barrier },
  }));
  t.after(async () => { await Promise.all(workers.map(worker => worker.terminate())); });
  const ready = workers.map(worker => new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); }));
  const exited = workers.map(worker => new Promise<void>((resolve, reject) => { worker.once('exit', code => code === 0 ? resolve() : reject(new Error('Worker failed'))); worker.once('error', reject); }));
  await Promise.all(ready);
  const results = workers.map(worker => new Promise<{ kind: string }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); }));
  Atomics.store(gate, 0, 1); Atomics.notify(gate, 0, workers.length);
  assert.deepEqual((await Promise.all(results)).map(value => value.kind).sort(), ['busy', 'start']);
  await Promise.all(exited);
  assert.equal(h.gateway.store.unsettled().length, 1);
});

test('source outbox recovers a committed POST without its acknowledgement and validates active run ownership', async t => {
  const h = setup(t); const request = h.accept('first', 'Private prompt must stay in admission state');
  const bodies: unknown[] = []; let first = true;
  const server = createServer(async (incoming, response) => {
    if (incoming.method === 'POST') {
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(chunk);
      bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
      if (first) { first = false; response.writeHead(503).end('{}'); return; }
      response.end(JSON.stringify({ event: 3, routed: ['pilot'], paused: [], duplicate: true }));
    } else response.end(JSON.stringify({ event: 3, routed: ['pilot'], paused: [], runs: [{ run: 5, rule: 'pilot', state: 'claimed' }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const source = new AutoloopSource('http://127.0.0.1:' + (server.address() as AddressInfo).port, 'fixture-key');
  const outbox = new SourceOutbox(h.gateway, source);
  await outbox.flush();
  assert.equal(h.gateway.store.submission(request.id)!.status, 'pending');
  // Claim admission reconciles the same source ID even while delivery is backing off.
  assert.equal((await outbox.claim(h.job(request.id, 5))).kind, 'start');
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
  assert.doesNotMatch(JSON.stringify(bodies), /Private prompt/);
  assert.equal(h.gateway.store.submission(request.id)!.status, 'scheduled');
  await assert.rejects(outbox.claim(h.job(request.id, 6)), /active run/);
  assert.equal(h.gateway.store.unsettled().length, 1);
});
