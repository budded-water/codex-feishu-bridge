import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from '../src/config.js';
import { PilotAdmission, type PilotScope } from '../src/handoff/gateway.js';
import { FeishuAdmission } from '../src/channels/feishu-admission.js';
import { NativeExecutions, type ManagedCodex } from '../src/handoff/native.js';
import { probeOwner } from '../src/handoff/owner-channel.js';
import { validateNativeRegistry } from '../src/handoff/registry.js';
import { FakeCodex, until } from './helpers.js';

class ManagedFake extends FakeCodex implements ManagedCodex {
  starts = 0;
  closes = 0;
  exitGate = Promise.resolve();
  async start() { this.starts++; this.ready = true; this.generation = randomUUID(); }
  async close() { this.closes++; await this.exitGate; this.exit(); }
}

function setup(t: TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-assignment-test-')));
  const project = join(root, 'project'); mkdirSync(project);
  const state = join(root, 'admission');
  const scope: PilotScope = { installation: 'fixture', tenant: 'tenant', operator: 'ou_owner', chat: 'chat', projects: { pilot: project },
    pilot: 'pilot', hubInstance: 'hub', source: 'fixture', rule: 'pilot', agent: 'native', agentUse: 'bridge-native' };
  const config: Config = { allowedUsers: ['ou_owner', 'ou_admin'], accessMode: 'allowlist', allowedTenant: 'tenant', enableGroups: false,
    groupContextMessages: 0, groupContextImages: 0, approvalUsers: ['ou_admin'], approvalChat: 'admin-chat', codexExecutable: 'codex',
    stateDirectory: state, approvalTimeoutSeconds: 300, projects: { pilot: project }, projectRouting: 'manual' };
  const gateway = new PilotAdmission(state, scope);
  const opened = [gateway];
  const actor = (text: string) => ({ tenant: scope.tenant, user: scope.operator, chat: scope.chat, id: randomUUID(), text });
  const accept = (input = 'Work') => {
    const admitted = gateway.receive(actor(input)); assert.ok('request' in admitted);
    const grant = gateway.store.reserve(admitted.request.id, Math.floor(Math.random() * 1_000_000) + 1);
    assert.equal(grant.kind, 'start');
    if (grant.kind !== 'start') throw new Error('Missing grant');
    return grant;
  };
  const reopen = () => { const next = new PilotAdmission(state, scope); opened.push(next); return next; };
  t.after(() => { for (const item of opened) item.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, state, scope, config, gateway, actor, accept, reopen };
}

async function active(client: ManagedFake) {
  await until(() => client.calls.some(call => call.method === 'turn/start'));
  const request = client.calls.find(call => call.method === 'turn/start')!;
  const sequence = client.calls.filter(call => ['thread/start', 'turn/start'].includes(call.method)).length;
  return { thread: String(request.params.threadId), turn: 'turn-' + sequence };
}

test('one assigned native turn keeps its conversation and waits for child settlement before releasing the project', async t => {
  const h = setup(t); const first = h.accept('Inspect literal task data');
  const firstClient = new ManagedFake();
  let release!: () => void;
  firstClient.exitGate = new Promise(resolve => { release = resolve; });
  const runtime = new NativeExecutions(h.gateway, h.config, () => firstClient);
  t.after(async () => { release(); await runtime.stop(); });
  const running = runtime.run(first.permit);
  const turn = await active(firstClient);
  firstClient.complete(turn.thread, turn.turn, 'completed', 'Large final answer '.repeat(10_000));
  await until(() => firstClient.closes > 0);
  assert.equal(h.gateway.store.execution(first.permit.execution)!.status, 'active');
  assert.equal((await runtime.recover())[0]!.status, 'live');
  const preview = await runtime.inspect(first.permit.execution);
  assert.ok((preview.messages as { truncated: boolean }[]).some(message => message.truncated));
  release();
  const evidence = await running;
  assert.equal(evidence.outcome.status, 'completed');
  assert.equal(h.gateway.store.unsettled().length, 0);
  assert.equal(h.gateway.store.conversationThread(first.request.conversation), turn.thread);
  assert.equal((await runtime.run(first.permit)).checkpoint, evidence.checkpoint);
  assert.equal(firstClient.starts, 1);

  const next = h.accept('Continue the same conversation');
  const nextClient = new ManagedFake();
  const continued = new NativeExecutions(h.gateway, h.config, () => nextClient);
  const second = continued.run(next.permit);
  const nextTurn = await active(nextClient);
  assert.equal(nextClient.calls.find(call => call.method === 'thread/resume')!.params.threadId, turn.thread);
  runtime.apply(first.permit.execution);
  assert.equal(h.gateway.store.unsettled()[0]!.id, next.permit.execution);
  nextClient.complete(nextTurn.thread, nextTurn.turn);
  await second;
});

test('a terminal checkpoint survives a lost gateway update and reconciles without another native start', async t => {
  const h = setup(t); const grant = h.accept(); const client = new ManagedFake();
  const runtime = new NativeExecutions(h.gateway, h.config, () => client);
  h.gateway.terminal = () => { throw new Error('Gateway unavailable'); };
  const running = runtime.run(grant.permit);
  const turn = await active(client);
  client.complete(turn.thread, turn.turn);
  await assert.rejects(running, /Gateway unavailable/);
  assert.equal(h.gateway.store.unsettled().length, 1);
  const reopened = h.reopen();
  const recovering = new NativeExecutions(reopened, h.config, () => { throw new Error('Recovery must inspect retained evidence'); });
  assert.deepEqual(await recovering.recover(), [{ execution: grant.permit.execution, status: 'settled' }]);
  assert.equal(reopened.store.execution(grant.permit.execution)!.status, 'completed');
  assert.equal(reopened.store.unsettled().length, 0);
  assert.equal(client.starts, 1);
});

test('pending ownership, live controls and lost native process preserve their bound execution', async t => {
  const h = setup(t); const grant = h.accept(); const client = new ManagedFake();
  const runtime = new NativeExecutions(h.gateway, h.config, () => client);
  const running = runtime.run(grant.permit);
  const turn = await active(client);
  const reopened = h.reopen(); const recovery = new NativeExecutions(reopened, h.config);
  assert.equal((await recovery.recover())[0]!.status, 'live');
  const owner = JSON.parse(readFileSync(join(h.state, 'executions', grant.permit.execution, 'native-owner.json'), 'utf8'));
  await assert.rejects(probeOwner(owner.socket, 'wrong', grant.permit.execution), /reply/);
  await recovery.control(grant.permit.execution, { ...h.actor('/补充 wrong owner'), user: 'ou_intruder' });
  assert.ok(!client.calls.some(call => call.method === 'turn/steer'));
  const supplement = h.actor('/补充 Inspect current changes');
  await recovery.control(grant.permit.execution, supplement);
  await recovery.control(grant.permit.execution, supplement);
  assert.equal(client.calls.filter(call => call.method === 'turn/steer').length, 1);
  assert.equal(client.calls.find(call => call.method === 'turn/steer')!.params.expectedTurnId, turn.turn);
  client.exit();
  assert.equal((await running).outcome.status, 'unknown');
  assert.equal((await recovery.recover())[0]!.status, 'unknown');
  assert.equal(reopened.store.unsettled().length, 1);
  const replay = await runtime.run(grant.permit);
  assert.equal(replay.outcome.status, 'unknown'); assert.equal(client.starts, 1);
});

test('a grant without an owner record becomes uncertain; evidence mutation is detected', async t => {
  const h = setup(t); const first = h.accept();
  const orphan = new NativeExecutions(h.gateway, h.config, () => { throw new Error('Unexpected native start'); });
  assert.deepEqual(await orphan.recover(), [{ execution: first.permit.execution, status: 'unknown' }]);
  assert.equal(h.gateway.store.execution(first.permit.execution)!.status, 'unknown');
  await assert.rejects(orphan.run(first.permit), /launch authority/);
  const recoveryMessage = h.actor('/reconcile ' + first.permit.execution);
  h.gateway.reconcile(recoveryMessage, { execution: first.permit.execution, processSettled: true, effectsChecked: true, reference: 'Fixture verified no native owner was launched' });
  await assert.rejects(orphan.run(first.permit), /launch authority/);
  const next = h.accept('New work'); const client = new ManagedFake();
  const runtime = new NativeExecutions(h.gateway, h.config, () => client);
  const running = runtime.run(next.permit);
  const turn = await active(client); client.complete(turn.thread, turn.turn); await running;
  const folder = join(h.state, 'executions', next.permit.execution);
  writeFileSync(join(folder, 'bridge.db'), Buffer.concat([readFileSync(join(folder, 'bridge.db')), Buffer.from('changed')]));
  assert.throws(() => runtime.evidence(next.permit.execution), /evidence changed/);
});

test('legacy admission data moves its bot binding and gains conversation fields without changing request identities', t => {
  const h = setup(t); const grant = h.accept();
  const db = new DatabaseSync(join(h.state, 'handoff.db'));
  const saved = db.prepare('SELECT value FROM binding').get() as { value: string };
  const legacy = { ...JSON.parse(saved.value), botOpenId: 'ou_fixture_bot' };
  db.prepare('UPDATE binding SET value=?').run(JSON.stringify(legacy));
  for (const column of ['thread', 'last_execution']) db.exec('ALTER TABLE conversations DROP COLUMN ' + column);
  for (const column of ['native_thread', 'native_turn', 'native_generation']) db.exec('ALTER TABLE executions DROP COLUMN ' + column);
  db.close();
  const reopened = h.reopen();
  assert.equal(reopened.store.request(grant.request.id)!.execution, grant.permit.execution);
  assert.equal(reopened.store.conversationThread(grant.request.conversation), null);
  new FeishuAdmission(reopened, 'ou_fixture_bot');
  assert.throws(() => new FeishuAdmission(reopened, 'ou_other_bot'), /identity/);
});

test('the public worker registry rejects split project authority and scheduler session inheritance', t => {
  const h = setup(t);
  const rule = { name: h.scope.rule, to: h.scope.agent, cwd: h.gateway.directory, group: 'one-project', parallel: 1,
    resume: false, when: { source: h.scope.source } };
  const registry = { agents: { [h.scope.agent]: { use: h.scope.agentUse, worker: 'fixture-worker' } }, rules: [rule] };
  validateNativeRegistry(h.gateway, registry);
  assert.throws(() => validateNativeRegistry(h.gateway, { ...registry, rules: [{ ...rule, resume: true }] }), /scope/);
  assert.throws(() => validateNativeRegistry(h.gateway, { ...registry, rules: [rule, { ...rule, name: 'alias', group: 'separate' }] }), /aliases/);
  assert.throws(() => validateNativeRegistry(h.gateway, { ...registry, rules: [rule, rule] }), /registry/);
});

test('assigned execution preserves disabled group access before creating a native process', async t => {
  const h = setup(t);
  const admitted = h.gateway.receive({ ...h.actor('Work in the pilot'), chatType: 'group' });
  assert.ok('request' in admitted);
  const grant = h.gateway.store.reserve(admitted.request.id, 1);
  assert.equal(grant.kind, 'start');
  if (grant.kind !== 'start') throw new Error('Missing grant');
  const client = new ManagedFake();
  const runtime = new NativeExecutions(h.gateway, h.config, () => client);
  await assert.rejects(runtime.run(grant.permit), /pilot chat/);
  assert.equal(client.starts, 0);
  assert.equal(h.gateway.store.unsettled().length, 1);
});
