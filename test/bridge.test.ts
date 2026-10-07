import test from 'node:test';
import assert from 'node:assert/strict';
import { message, setup, until } from './helpers.js';

test('only authorized, distinct messages can execute; completed output is returned', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Ignore me', { user: 'ou_attacker' }));
  const input = message('Investigate');
  h.bridge.receive(input); h.bridge.receive(input);
  await until(() => h.turns().length === 1);
  assert.equal(h.turns().length, 1);
  const active = h.current();
  h.codex.complete(active.threadId, active.turnId, 'completed', 'Verified result');
  await until(() => h.state.status(h.session.id).some(row => row.status === 'completed'));
  assert.ok(h.deliveries().some(text => text.includes('Verified result')));
});

test('redelivered enrollment challenges never execute or queue a Codex task', async t => {
  const h = setup(); t.after(h.close);
  const text = 'pair 12345678-1234-1234-1234-123456789abc';
  const enrollment = message(text);
  h.bridge.receive(enrollment);
  h.bridge.receive(enrollment);
  h.bridge.receive(message(text));
  h.bridge.receive(message('/status'));
  assert.deepEqual(h.state.status(h.session.id), []);
  assert.equal(h.turns().length, 0);
  assert.ok(h.deliveries().some(reply => reply.includes('暂无任务')));
  h.bridge.receive(message(`Explain the enrollment syntax: ${text}`));
  await until(() => h.turns().length === 1);
  h.bridge.receive(message(text));
  assert.deepEqual(h.state.status(h.session.id).map(row => ({ ...row })), [{ status: 'running', count: 1 }]);
  assert.equal(h.turns().length, 1);
});

test('tasks remain bound to their project and serialize per directory while other projects run', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('First alpha'));
  await until(() => h.turns().length === 1);
  const first = h.current();
  h.bridge.receive(message('Second alpha'));
  h.bridge.receive(message('/project beta'));
  h.bridge.receive(message('First beta'));
  await until(() => h.turns().length === 2);
  assert.deepEqual(h.turns().map(call => call.params.cwd), [h.config.projects.alpha, h.config.projects.beta]);
  h.codex.complete(first.threadId, first.turnId);
  await until(() => h.turns().length === 3);
  assert.equal(h.turns()[2]!.params.cwd, h.config.projects.alpha);
});

test('different aliases of the same real directory do not execute concurrently', async t => {
  const h = setup(); t.after(h.close);
  h.config.projects.beta = h.config.projects.alpha!;
  h.bridge.receive(message('First task'));
  await until(() => h.turns().length === 1);
  const first = h.current();
  h.bridge.receive(message('/project beta'));
  h.bridge.receive(message('Second task'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.turns().length, 1);
  h.codex.complete(first.threadId, first.turnId);
  await until(() => h.turns().length === 2);
});

test('steering and stopping target the actual active turn, and stale approvals cannot survive interruption', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  const active = h.current();
  h.codex.ask('approval', 'item/commandExecution/requestApproval', { ...active, command: 'echo hello' });
  const token = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message('/补充 Inspect tests too'));
  assert.equal(h.codex.calls.find(call => call.method === 'turn/steer')!.params.expectedTurnId, active.turnId);
  h.bridge.receive(message('/stop'));
  await until(() => h.state.status(h.session.id).some(row => row.status === 'interrupted'));
  h.bridge.receive(message(`/批准 ${token}`));
  assert.equal(h.codex.replies.length, 0);
});

test('creating a new session while busy cannot hide its approvals', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  h.bridge.receive(message('/new'));
  assert.equal(h.state.selected(message(''))!.id, h.session.id);
  assert.ok(h.deliveries().some(text => text.includes('仍有任务')));
});

test('approval is bound to the original owner/chat and may be answered after a project switch', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  h.codex.ask(100, 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo approved' });
  const token = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message('/project beta', { chat: 'other-chat' }));
  h.bridge.receive(message(`/批准 ${token}`, { chat: 'other-chat' }));
  h.bridge.receive(message(`/批准 ${token}`, { user: 'ou_attacker' }));
  assert.equal(h.codex.replies.length, 0);
  h.bridge.receive(message('/project beta'));
  h.bridge.receive(message(`/批准 ${token}`));
  h.bridge.receive(message(`/批准 ${token}`));
  assert.deepEqual(h.codex.replies, [{ id: 100, result: { decision: 'accept' } }]);
});

test('timeouts decline instead of authorizing; late replies have no effect', async t => {
  const h = setup(); t.after(h.close);
  h.config.approvalTimeoutSeconds = 0.03;
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  h.codex.ask(101, 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo timeout' });
  const token = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  await until(() => h.codex.replies.length === 1);
  h.bridge.receive(message(`/批准 ${token}`));
  assert.deepEqual(h.codex.replies, [{ id: 101, result: { decision: 'decline' } }]);
});

test('requests resolved by Codex or a prior process cannot be approved', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  h.codex.ask(102, 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo old' });
  const token = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  h.codex.notify('serverRequest/resolved', { requestId: 102 });
  h.bridge.receive(message(`/批准 ${token}`));
  assert.equal(h.codex.replies.length, 0);
  h.codex.ask(103, 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo old-process' });
  const second = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  h.codex.generation = 'generation-2';
  h.bridge.receive(message(`/批准 ${second}`));
  assert.equal(h.codex.replies.length, 0);
});

test('file approvals display changes; missing action details are denied', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  const active = h.current();
  h.codex.ask(104, 'item/fileChange/requestApproval', { ...active, itemId: 'missing' });
  assert.deepEqual(h.codex.replies[0], { id: 104, result: { decision: 'decline' } });
  h.codex.notify('item/started', { ...active, item: { type: 'fileChange', id: 'patch', changes: [{ path: 'file.ts', diff: '+new behavior' }] } });
  h.codex.ask(105, 'item/fileChange/requestApproval', { ...active, itemId: 'patch' });
  const preview = h.deliveries().join('\n');
  assert.ok(preview.includes('file.ts') && preview.includes('+new behavior'));
  const token = preview.match(/请求 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message(`/拒绝 ${token}`));
  assert.deepEqual(h.codex.replies[1], { id: 105, result: { decision: 'decline' } });
});

test('user questions require a matching question ID; sensitive and unsupported requests fail closed', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  const active = h.current();
  h.codex.ask(106, 'item/tool/requestUserInput', { ...active, questions: [{ id: 'choice', question: 'Choose', isSecret: false, options: [{ label: 'A' }] }] });
  const token = h.deliveries().join('\n').match(/问题 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message(`/回答 ${token} wrong A`));
  assert.equal(h.codex.replies.length, 0);
  h.bridge.receive(message(`/回答 ${token} choice A`));
  assert.deepEqual(h.codex.replies[0], { id: 106, result: { answers: { choice: { answers: ['A'] } } } });
  h.codex.ask(107, 'item/tool/requestUserInput', { ...active, questions: [{ id: 'secret', isSecret: true }] });
  assert.deepEqual(h.codex.replies[1], { id: 107, result: { answers: {} } });
  h.codex.ask(108, 'item/permissions/requestApproval', active);
  assert.deepEqual(h.codex.replies[2], { id: 108, result: { permissions: {}, scope: 'turn' } });
  h.codex.ask(109, 'unknown/request', active);
  assert.deepEqual(h.codex.rejected, [109]);
});

test('process loss stops queued work instead of replaying and records an uncertain outcome', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('First'));
  await until(() => h.turns().length === 1);
  h.bridge.receive(message('Second'));
  h.codex.exit();
  const statuses = h.state.status(h.session.id);
  assert.ok(statuses.some(row => row.status === 'unknown'));
  assert.ok(statuses.some(row => row.status === 'interrupted'));
  h.codex.ready = true; h.codex.generation = 'new'; h.bridge.kick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.turns().length, 1);
});

test('queue clearing cancels waiting tasks without interrupting the active turn', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('First'));
  await until(() => h.turns().length === 1);
  const active = h.current();
  h.bridge.receive(message('Second'));
  h.bridge.receive(message('/clear'));
  h.codex.complete(active.threadId, active.turnId);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(h.turns().length, 1);
  assert.ok(h.state.status(h.session.id).some(row => row.status === 'interrupted'));
});

test('a completion for another turn cannot finish the active task', async t => {
  const h = setup(); t.after(h.close);
  h.bridge.receive(message('Work'));
  await until(() => h.turns().length === 1);
  h.codex.notify('turn/completed', { threadId: h.current().threadId, turn: { id: 'old-turn', status: 'completed' } });
  assert.ok(h.state.status(h.session.id).some(row => row.status === 'running'));
});

test('completion arriving before the turn/start RPC response cannot be overwritten as running', async t => {
  const h = setup(); t.after(h.close);
  const original = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    const result = await original<T>(method, params);
    if (method === 'turn/start') {
      const active = h.current(); h.codex.complete(active.threadId, active.turnId);
    }
    return result;
  };
  h.bridge.receive(message('Work'));
  await until(() => h.state.status(h.session.id).some(row => row.status === 'completed'));
  assert.ok(!h.state.status(h.session.id).some(row => row.status === 'running'));
});


test('tenant colleagues in one group have isolated threads and cannot steer or stop each other', async t => {
  const h = setup(); t.after(h.close);
  h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant';
  const alice = { user: 'ou_alice', chat: 'group' };
  const bob = { user: 'ou_bob', chat: 'group' };
  h.bridge.receive(message('/project alpha', { ...alice, tenant: 'outside' }));
  assert.equal(h.state.selected(message('', { ...alice, tenant: 'outside' })), undefined);
  h.bridge.receive(message('/project alpha', alice));
  h.bridge.receive(message('Alice task', alice));
  await until(() => h.turns().length === 1);
  const first = h.current();
  h.bridge.receive(message('/project alpha', bob));
  h.bridge.receive(message('/补充 Change Alice task', bob));
  h.bridge.receive(message('/stop', bob));
  h.bridge.receive(message('Bob task', bob));
  assert.equal(h.turns().length, 1);
  assert.equal(h.codex.calls.some(call => ['turn/steer', 'turn/interrupt'].includes(call.method)), false);
  h.codex.complete(first.threadId, first.turnId);
  await until(() => h.turns().length === 2);
  assert.notEqual(h.current().threadId, first.threadId);
  assert.notEqual(h.state.selected(message('', alice))!.id, h.state.selected(message('', bob))!.id);
});

test('only configured administrators can decide colleague approvals in the routed approval chat', async t => {
  const h = setup(); t.after(h.close);
  h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant'; h.config.approvalChat = 'oc_admin';
  const colleague = { user: 'ou_colleague', chat: 'group' };
  h.bridge.receive(message('/project alpha', colleague)); h.bridge.receive(message('Colleague task', colleague));
  await until(() => h.turns().length === 1);
  h.codex.ask('team-approval', 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo bounded' });
  const preview = h.state.pending(Number.MAX_SAFE_INTEGER).find(reply => reply.body.includes('动作：'))!;
  assert.equal(preview.chat, 'oc_admin');
  const token = preview.body.match(/请求 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message(`/批准 ${token}`, { user: 'ou_colleague', chat: 'oc_admin' }));
  h.bridge.receive(message(`/批准 ${token}`, { user: 'ou_owner', chat: 'group' }));
  h.bridge.receive(message(`/批准 ${token}`, { user: 'ou_owner', chat: 'oc_admin', tenant: 'outside' }));
  assert.equal(h.codex.replies.length, 0);
  assert.equal(h.state.selected(message('', { chat: 'oc_admin' })), undefined);
  h.bridge.receive(message(`/批准 ${token}`, { chat: 'oc_admin' }));
  assert.deepEqual(h.codex.replies, [{ id: 'team-approval', result: { decision: 'accept' } }]);
  h.bridge.receive(message(`/批准 ${token}`, { chat: 'oc_admin' }));
  assert.equal(h.codex.replies.length, 1);
});

test('administrators cannot answer a colleague question; only its submitter in the original chat can', async t => {
  const h = setup(); t.after(h.close);
  h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant'; h.config.approvalChat = 'oc_admin';
  const colleague = { user: 'ou_colleague', chat: 'group' };
  h.bridge.receive(message('/project alpha', colleague)); h.bridge.receive(message('Colleague task', colleague));
  await until(() => h.turns().length === 1);
  h.codex.ask('team-question', 'item/tool/requestUserInput', { ...h.current(), questions: [{ id: 'q', question: 'Which file?' }] });
  const token = h.deliveries().join('\n').match(/问题 ([a-f0-9]{8})/)![1]!;
  h.bridge.receive(message(`/回答 ${token} q wrong`, { chat: 'oc_admin' }));
  h.bridge.receive(message(`/回答 ${token} q wrong`, { ...colleague, chat: 'other-group' }));
  assert.equal(h.codex.replies.length, 0);
  h.bridge.receive(message(`/回答 ${token} q chosen`, colleague));
  assert.deepEqual(h.codex.replies, [{ id: 'team-question', result: { answers: { q: { answers: ['chosen'] } } } }]);
});


test('routed colleague approvals expire in the administrator chat and late decisions remain ineffective', async t => {
  const h = setup(); t.after(h.close);
  h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant'; h.config.approvalChat = 'oc_admin'; h.config.approvalTimeoutSeconds = 0.03;
  const colleague = { user: 'ou_colleague', chat: 'group' };
  h.bridge.receive(message('/project alpha', colleague)); h.bridge.receive(message('Colleague task', colleague));
  await until(() => h.turns().length === 1);
  h.codex.ask('expiring-team-approval', 'item/commandExecution/requestApproval', { ...h.current(), command: 'echo bounded' });
  const token = h.deliveries().join('\n').match(/请求 ([a-f0-9]{8})/)![1]!;
  await until(() => h.codex.replies.length === 1);
  const notices = h.state.pending(Number.MAX_SAFE_INTEGER);
  assert.ok(notices.some(reply => reply.chat === 'oc_admin' && reply.body.includes('已超时')));
  assert.ok(notices.some(reply => reply.chat === 'group' && reply.body.includes('已超时')));
  h.bridge.receive(message(`/批准 ${token}`, { chat: 'oc_admin' }));
  assert.deepEqual(h.codex.replies, [{ id: 'expiring-team-approval', result: { decision: 'decline' } }]);
});
