import test from 'node:test';
import assert from 'node:assert/strict';
import { message, setup, until, FakeCodex } from './helpers.js';
import { routingConfig } from '../src/routing.js';

const decision = (kind: 'answer' | 'question' | 'project', project: string | null, text = '', continuePending = false) => JSON.stringify({ kind, project, text, continuePending });

test('a clear Codex project decision requeues once into the registered directory without publishing routing text', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('查 beta 的注册人数'));
  await until(() => h.turns().length === 1);
  assert.notEqual(h.turns()[0]!.params.cwd, h.config.projects.alpha);
  assert.equal((h.turns()[0]!.params.outputSchema as { title: string }).title, 'BridgeRoute');
  const router = h.current(); h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'beta'));
  await until(() => h.turns().length === 2);
  assert.equal(h.turns()[1]!.params.cwd, h.config.projects.beta);
  assert.equal(h.state.selected(message(''))!.project, 'beta');
  assert.deepEqual(h.deliveries(), []);
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'alpha'));
  assert.equal(h.turns().length, 2);
  const execution = h.current(); h.codex.complete(execution.threadId, execution.turnId, 'completed', 'Verified count');
  assert.match(h.deliveries()[0]!, /Verified count/);
});

test('ordinary chat answers once and does not execute a project', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('你好')); await until(() => h.turns().length === 1);
  const router = h.current(); h.codex.complete(router.threadId, router.turnId, 'completed', decision('answer', null, '你好！'));
  await until(() => !h.state.directories().length);
  assert.deepEqual(h.deliveries(), ['你好！']);
  assert.equal(h.turns().length, 1);
});

test('ambiguity asks one question and same-owner clarification carries the pending request into execution', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('查一下注册人数')); await until(() => h.turns().length === 1);
  const first = h.current(); h.codex.complete(first.threadId, first.turnId, 'completed', decision('question', null, '你想查 alpha 还是 beta？'));
  await until(() => !h.state.directories().length);
  assert.deepEqual(h.deliveries(), ['你想查 alpha 还是 beta？']);
  h.bridge.receive(message('beta')); await until(() => h.turns().length === 2);
  assert.ok(JSON.stringify(h.turns()[1]!.params.input).includes('查一下注册人数'));
  const second = h.current(); h.codex.complete(second.threadId, second.turnId, 'completed', decision('project', 'beta', '', true));
  await until(() => h.turns().length === 3);
  assert.ok(JSON.stringify(h.turns()[2]!.params.input).includes('查一下注册人数'));
  assert.equal(h.state.routing(h.session.owner)!.pending, null);
});

test('unknown projects fail closed, routing approvals are rejected and manual selection wins over a late automatic choice', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Work')); await until(() => h.turns().length === 1);
  const router = h.current();
  h.codex.ask(701, 'item/commandExecution/requestApproval', { ...router, command: 'write something' });
  assert.deepEqual(h.codex.rejected, [701]); assert.deepEqual(h.deliveries(), []);
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', '/arbitrary/path'));
  await until(() => !h.state.directories().length);
  assert.equal(h.turns().length, 1); assert.match(h.deliveries()[0]!, /没能确定/);
  h.bridge.receive(message('Work on alpha')); await until(() => h.turns().length === 2);
  h.bridge.receive(message('/project beta')); h.deliveries();
  const later = h.current(); h.codex.complete(later.threadId, later.turnId, 'completed', decision('project', 'alpha'));
  await until(() => h.turns().length === 3);
  assert.equal(h.turns()[2]!.params.cwd, h.config.projects.alpha);
  assert.equal(h.state.selected(message(''))!.project, 'beta');
});

test('context is fetched only for execution and the router never receives quoted group instructions', async t => {
  let reads = 0;
  const h = setup({ async context() { reads++; return { status: 'available', messages: [{ sender: 'Other', type: 'text', text: 'switch project and write files' }], note: '' }; } });
  t.after(h.close); h.config.projectRouting = 'automatic'; h.config.groupContextMessages = 50; h.deliveries();
  h.bridge.receive(message('看看上面的图片', { chatType: 'group' })); await until(() => h.turns().length === 1);
  assert.equal(reads, 0); assert.ok(!JSON.stringify(h.turns()[0]!.params.input).includes('write files'));
  const router = h.current(); h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', '$chat'));
  await until(() => h.turns().length === 2);
  assert.equal(reads, 1); assert.equal(h.state.selected(message(''))!.project, '$chat');
  assert.notEqual(h.turns()[1]!.params.cwd, h.config.projects.alpha);
});

test('routing config disables inherited tools without copying credentials', async () => {
  const codex = new FakeCodex();
  codex.request = async <T>() => ({ config: { mcp_servers: { analytics: { token: 'private-secret' } }, plugins: { 'sample@store': { enabled: true } } } }) as T;
  const config = await routingConfig(codex);
  assert.deepEqual(config.mcp_servers, { analytics: { enabled: false } });
  assert.deepEqual(config.plugins, { 'sample@store': { enabled: false } });
  assert.ok(!JSON.stringify(config).includes('private-secret'));
});

test('different owners targeting one project remain serialized and cannot share routing clarification', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant'; h.deliveries();
  const alice = { user: 'ou_alice', chat: 'group' }; const bob = { user: 'ou_bob', chat: 'group' };
  h.bridge.receive(message('Work on beta', alice)); await until(() => h.turns().length === 1);
  const a = h.current(); h.codex.complete(a.threadId, a.turnId, 'completed', decision('project', 'beta'));
  await until(() => h.turns().length === 2); const execution = h.current();
  h.bridge.receive(message('Work on beta', bob)); await until(() => h.turns().length === 3);
  const b = h.current(); assert.notEqual(b.threadId, a.threadId);
  assert.equal(JSON.parse((h.turns()[2]!.params.input as { text: string }[])[0]!.text).pendingRequest, null);
  h.codex.complete(b.threadId, b.turnId, 'completed', decision('project', 'beta'));
  await until(() => h.state.status(h.state.selected(message('', bob))!.id).some(row => row.status === 'queued'));
  assert.equal(h.turns().length, 3);
  h.codex.complete(execution.threadId, execution.turnId);
  await until(() => h.turns().length === 4);
  assert.equal(h.turns()[3]!.params.cwd, h.config.projects.beta);
});


test('status and stop find the owner routing turn when another owner occupies the selected project', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.config.accessMode = 'tenant'; h.config.allowedTenant = 'tenant'; h.deliveries();
  const bob = { user: 'bob', chat: 'group' }; const alice = { user: 'alice', chat: 'group' };
  h.bridge.receive(message('Work alpha', bob)); await until(() => h.turns().length === 1);
  const first = h.current(); h.codex.complete(first.threadId, first.turnId, 'completed', decision('project', 'alpha'));
  await until(() => h.turns().length === 2); const execution = h.current();
  h.bridge.receive(message('/project alpha', alice)); h.deliveries();
  h.bridge.receive(message('Work beta', alice)); await until(() => h.turns().length === 3); const router = h.current();
  h.bridge.receive(message('/status', alice)); assert.match(h.deliveries()[0]!, /正在理解请求/);
  h.bridge.receive(message('/stop', alice));
  await until(() => h.codex.calls.some(call => call.method === 'turn/interrupt'));
  const interrupted = h.codex.calls.filter(call => call.method === 'turn/interrupt');
  assert.equal(interrupted.length, 1); assert.equal(interrupted[0]!.params.threadId, router.threadId);
  assert.notEqual(interrupted[0]!.params.threadId, execution.threadId);
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'beta'));
  assert.equal(h.turns().length, 3);
});

test('clearing pending clarification cannot resurrect the old request on a later message', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Query users')); await until(() => h.turns().length === 1);
  const first = h.current(); h.codex.complete(first.threadId, first.turnId, 'completed', decision('question', null, 'Which project?'));
  await until(() => !h.state.directories().length); h.deliveries();
  h.bridge.receive(message('/clear')); h.deliveries();
  h.bridge.receive(message('Work beta')); await until(() => h.turns().length === 2);
  assert.equal(JSON.parse((h.turns()[1]!.params.input as {text: string}[])[0]!.text).pendingRequest, null);
  const second = h.current(); h.codex.complete(second.threadId, second.turnId, 'completed', decision('project', 'beta', '', true));
  await until(() => h.turns().length === 3);
  assert.ok(!JSON.stringify(h.turns()[2]!.params.input).includes('Query users'));
});

test('routing handoff waits for steering acceptance and preserves the latest execution constraints', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Modify alpha')); await until(() => h.turns().length === 1); const router = h.current();
  const request = h.codex.request.bind(h.codex); let release!: () => void;
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/steer') await new Promise<void>(done => { release = done; });
    return request<T>(method, params);
  };
  h.bridge.receive(message('/补充 Only inspect beta; do not modify anything'));
  await until(() => Boolean(release));
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'beta'));
  assert.equal(h.turns().length, 1);
  release(); await until(() => h.turns().length === 2);
  const input = JSON.stringify(h.turns()[1]!.params.input);
  assert.ok(input.includes('Modify alpha')); assert.ok(input.includes('Only inspect beta; do not modify anything'));
  assert.equal(h.turns()[1]!.params.cwd, h.config.projects.beta);
});

test('failed routing steering cannot hand off a task without the user constraints', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Modify alpha')); await until(() => h.turns().length === 1); const router = h.current();
  const request = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/steer') throw new Error('stale turn');
    return request<T>(method, params);
  };
  h.bridge.receive(message('/补充 Do not modify anything'));
  await until(() => !h.state.directories().length);
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'alpha'));
  assert.equal(h.turns().length, 1); assert.match(h.deliveries().join(''), /请求已停止/);
  assert.ok(h.codex.calls.some(call => call.method === 'turn/interrupt'));
});

test('a completed classifier cannot hand off after a stop request whose RPC is still pending', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Modify beta')); await until(() => h.turns().length === 1); const router = h.current();
  const request = h.codex.request.bind(h.codex); let release!: () => void;
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/interrupt') await new Promise<void>(done => { release = done; });
    return request<T>(method, params);
  };
  h.bridge.receive(message('/stop')); await until(() => Boolean(release));
  h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'beta'));
  await until(() => !h.state.directories().length);
  assert.equal(h.turns().length, 1); assert.equal(h.state.selected(message(''))!.project, 'alpha');
  release(); await until(() => h.codex.calls.some(call => call.method === 'turn/interrupt'));
});

test('reselecting the same project and switching away and back defeat late automatic selection', async () => {
  for (const commands of [['/project alpha'], ['/project beta', '/project alpha']]) {
    const h = setup(); h.config.projectRouting = 'automatic'; h.deliveries();
    try {
      h.bridge.receive(message('Work beta')); await until(() => h.turns().length === 1); const router = h.current();
      const before = h.state.selectionRevision(h.session.owner);
      for (const command of commands) h.bridge.receive(message(command));
      assert.ok(h.state.selectionRevision(h.session.owner) > before); h.deliveries();
      h.codex.complete(router.threadId, router.turnId, 'completed', decision('project', 'beta'));
      await until(() => h.turns().length === 2);
      assert.equal(h.turns()[1]!.params.cwd, h.config.projects.beta);
      assert.equal(h.state.selected(message(''))!.project, 'alpha');
    } finally { await h.close(); }
  }
});

test('clarification preserves the original quoted source and history cutoff for execution context', async t => {
  const sources: {id: string; parentId?: string; createTime?: string}[] = [];
  const h = setup({ async context(_session, source) { sources.push(source); return { status: 'available', messages: [{ sender: 'Owner', type: 'text', text: 'original error logs' }], note: '' }; } });
  t.after(h.close); h.config.projectRouting = 'automatic'; h.config.groupContextMessages = 0; h.deliveries();
  const original = message('Fix this error', { chatType: 'group', parentId: 'quoted-logs', createTime: '1000' });
  h.bridge.receive(original); await until(() => h.turns().length === 1); const first = h.current();
  h.codex.complete(first.threadId, first.turnId, 'completed', decision('question', null, 'Which project?'));
  await until(() => !h.state.directories().length);
  assert.equal(h.state.routing(h.session.owner)!.source!.parentId, 'quoted-logs');
  h.bridge.receive(message('beta', { chatType: 'group', createTime: '2000' })); await until(() => h.turns().length === 2);
  const second = h.current(); h.codex.complete(second.threadId, second.turnId, 'completed', decision('project', 'beta', '', true));
  await until(() => h.turns().length === 3);
  assert.equal(sources.length, 1); assert.equal(sources[0]!.id, original.id);
  assert.equal(sources[0]!.parentId, 'quoted-logs'); assert.equal(sources[0]!.createTime, '1000');
  assert.ok(JSON.stringify(h.turns()[2]!.params.input).includes('original error logs'));
});


test('earlier automatic handoffs cannot discard a later queued clarification or project selection', async () => {
  for (const kind of ['question', 'project'] as const) {
    const h = setup(); h.config.projectRouting = 'automatic'; h.deliveries();
    try {
      h.bridge.receive(message('Work beta')); h.bridge.receive(message('Second request'));
      await until(() => h.turns().length === 1); const first = h.current();
      h.codex.complete(first.threadId, first.turnId, 'completed', decision('project', 'beta'));
      await until(() => h.turns().length === 3); const second = h.current();
      assert.ok(h.turns()[2]!.params.outputSchema);
      h.codex.complete(second.threadId, second.turnId, 'completed', kind === 'question' ? decision('question', null, 'Which project?') : decision('project', 'alpha'));
      if (kind === 'question') assert.equal(h.state.routing(h.session.owner)!.pending, 'Second request');
      else { await until(() => h.turns().length === 4); assert.equal(h.state.selected(message(''))!.project, 'alpha'); }
    } finally { await h.close(); }
  }
});

test('chat queue clearing does not cancel unclassified work submitted from a project session', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('First alpha')); await until(() => h.turns().length === 1);
  h.bridge.receive(message('Second alpha')); h.deliveries();
  h.bridge.receive(message('/chat')); h.deliveries(); h.bridge.receive(message('/clear'));
  assert.match(h.deliveries().join(''), /0 个排队任务/);
  assert.ok(h.state.status(h.session.id).some(row => row.status === 'queued' && row.count === 1));
  assert.ok(!h.state.status(h.state.selected(message(''))!.id).some(row => row.status === 'queued'));
});

test('oversized routing steering interrupts and drains before the next request uses the classifier', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('x'.repeat(20_000))); await until(() => h.turns().length === 1);
  const request = h.codex.request.bind(h.codex); let release!: () => void;
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/interrupt') await new Promise<void>(done => { release = done; });
    return request<T>(method, params);
  };
  h.bridge.receive(message('/补充 ' + 'y'.repeat(15_000))); await until(() => Boolean(release));
  h.bridge.receive(message('Another beta')); assert.equal(h.turns().length, 1);
  release(); await until(() => h.turns().length === 2);
  assert.ok(h.codex.calls.some(call => call.method === 'turn/interrupt'));
  assert.equal(JSON.parse((h.turns()[1]!.params.input as {text:string}[])[0]!.text).userRequest, 'Another beta');
  h.codex.request = request;
});

test('an uncertain classifier interruption cancels queued work and a new request uses a fresh thread', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('Modify alpha')); await until(() => h.turns().length === 1); const old = h.current();
  h.bridge.receive(message('Queued work'));
  const request = h.codex.request.bind(h.codex);
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/steer' || method === 'turn/interrupt') throw new Error('unconfirmed RPC');
    return request<T>(method, params);
  };
  h.bridge.receive(message('/补充 Do not modify anything'));
  await until(() => !h.state.directories().length);
  assert.equal(h.state.routing(h.session.owner), undefined);
  assert.ok(h.state.status(h.session.id).some(row => row.status === 'unknown'));
  assert.ok(h.state.status(h.session.id).some(row => row.status === 'interrupted'));
  h.codex.request = request;
  h.bridge.receive(message('A new request')); await until(() => h.turns().length === 2);
  const next = h.current(); assert.notEqual(next.threadId, old.threadId);
  h.codex.complete(old.threadId, old.turnId, 'completed', decision('project', 'alpha'));
  assert.equal(h.turns().length, 2);
  h.codex.complete(next.threadId, next.turnId, 'completed', decision('answer', null, 'New answer'));
});

test('stop during an unconfirmed routing start drains that turn before a subsequent request can reuse it', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  const request = h.codex.request.bind(h.codex);
  let releaseStart!: () => void; let releaseInterrupt!: () => void; let first = true;
  const started: {threadId:string;turnId:string}[] = [];
  h.codex.onNotification(event => {
    if (event.method === 'turn/started') started.push({threadId:String(event.params.threadId),turnId:String((event.params.turn as {id:string}).id)});
  });
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'turn/start' && first) {
      first = false; const body = params as Record<string,unknown>; h.codex.calls.push({method,params:body});
      await new Promise<void>(done => { releaseStart = done; });
      return {turn:{id:'unconfirmed-turn'}} as T;
    }
    if (method === 'turn/interrupt') await new Promise<void>(done => { releaseInterrupt = done; });
    return request<T>(method, params);
  };
  h.bridge.receive(message('Stopped alpha')); await until(() => Boolean(releaseStart));
  const thread = String(h.turns()[0]!.params.threadId);
  h.bridge.receive(message('/stop')); h.bridge.receive(message('New beta'));
  assert.equal(h.turns().length, 1);
  releaseStart(); await until(() => Boolean(releaseInterrupt));
  h.codex.complete(thread, 'unconfirmed-turn', 'completed', decision('project', 'alpha'));
  assert.equal(h.turns().length, 1);
  releaseInterrupt(); await until(() => h.turns().length === 2);
  h.codex.request = request;
  const next = started.at(-1)!;
  h.codex.complete(next.threadId, next.turnId, 'completed', decision('project', 'beta'));
  await until(() => h.turns().length === 3);
  assert.equal(h.turns()[2]!.params.cwd, h.config.projects.beta);
  assert.ok(JSON.stringify(h.turns()[2]!.params.input).includes('New beta'));
  assert.ok(!JSON.stringify(h.turns()[2]!.params.input).includes('Stopped alpha'));
});

test('early routing events are applied only after the returned turn ID confirms their request', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting = 'automatic'; h.deliveries();
  h.bridge.receive(message('First alpha')); await until(() => h.turns().length === 1); const old = h.current();
  h.codex.complete(old.threadId, old.turnId, 'completed', decision('project', 'alpha'));
  await until(() => h.turns().length === 2); const execution = h.current();
  h.codex.complete(execution.threadId, execution.turnId); await until(() => !h.state.directories().length);
  const request = h.codex.request.bind(h.codex); let releaseResume!: () => void; let releaseStart!: () => void;
  h.codex.request = async <T>(method: string, params: unknown): Promise<T> => {
    if (method === 'thread/resume') await new Promise<void>(done => { releaseResume = done; });
    if (method === 'turn/start') {
      h.codex.calls.push({method,params:params as Record<string,unknown>});
      await new Promise<void>(done => { releaseStart = done; });
      return {turn:{id:'confirmed-beta-turn'}} as T;
    }
    return request<T>(method, params);
  };
  h.bridge.receive(message('New beta')); await until(() => Boolean(releaseResume));
  h.codex.complete(old.threadId, old.turnId, 'completed', decision('project', 'alpha'));
  assert.equal(h.turns().length, 2);
  releaseResume(); await until(() => Boolean(releaseStart));
  h.codex.complete(old.threadId, old.turnId, 'completed', decision('project', 'alpha'));
  h.codex.complete(old.threadId, 'confirmed-beta-turn', 'completed', decision('project', 'beta'));
  assert.equal(h.turns().length, 3);
  h.codex.request = request; releaseStart(); await until(() => h.turns().length === 4);
  assert.equal(h.turns()[3]!.params.cwd, h.config.projects.beta);
  assert.ok(JSON.stringify(h.turns()[3]!.params.input).includes('New beta'));
});

test('aborted pending clarification cannot revive its original work or quoted source', async () => {
  for (const failure of ['rejected', 'oversized']) {
    const h = setup(); h.config.projectRouting = 'automatic'; h.deliveries();
    try {
      h.bridge.receive(message('Modify alpha', {chatType:'group',parentId:'old-quote'})); await until(() => h.turns().length === 1);
      const first = h.current(); h.codex.complete(first.threadId, first.turnId, 'completed', decision('question', null, 'Which project?'));
      await until(() => !h.state.directories().length);
      h.bridge.receive(message(failure === 'oversized' ? 'beta' + 'z'.repeat(20_000) : 'beta')); await until(() => h.turns().length === 2);
      const request = h.codex.request.bind(h.codex);
      if (failure === 'rejected') h.codex.request = async <T>(method:string,params:unknown):Promise<T> => {
        if (method === 'turn/steer') throw new Error('steering failed'); return request<T>(method,params);
      };
      h.bridge.receive(message('/补充 ' + (failure === 'oversized' ? 'y'.repeat(15_000) : 'Do not modify anything')));
      await until(() => !h.state.directories().length);
      assert.equal(h.state.routing(h.session.owner)!.pending, null);
      assert.equal(h.state.routing(h.session.owner)!.source, undefined);
      h.codex.request = request;
      h.bridge.receive(message('beta')); await until(() => h.turns().length === 3);
      assert.equal(JSON.parse((h.turns()[2]!.params.input as {text:string}[])[0]!.text).pendingRequest, null);
      const next = h.current(); h.codex.complete(next.threadId, next.turnId, 'completed', decision('project', 'beta', '', true));
      await until(() => h.turns().length === 4);
      assert.ok(!JSON.stringify(h.turns()[3]!.params.input).includes('Modify alpha'));
    } finally { await h.close(); }
  }
});

test('a failed decision after clarification cannot retain old authority with or without accepted steering', async () => {
  for (const steer of [false, true]) {
    const h = setup(); h.config.projectRouting = 'automatic'; h.deliveries();
    try {
      h.bridge.receive(message('Modify alpha')); await until(() => h.turns().length === 1);
      const first = h.current(); h.codex.complete(first.threadId, first.turnId, 'completed', decision('question', null, 'Which project?'));
      await until(() => !h.state.directories().length);
      h.bridge.receive(message(steer ? 'beta' : 'Cancel this')); await until(() => h.turns().length === 2);
      if (steer) {
        h.bridge.receive(message('/补充 Do not modify anything'));
        await until(() => h.codex.calls.some(call => call.method === 'turn/steer'));
      }
      const second = h.current(); h.codex.complete(second.threadId, second.turnId, 'completed', 'Invalid decision');
      await until(() => !h.state.directories().length);
      assert.equal(h.state.routing(h.session.owner)!.pending, null);
      h.bridge.receive(message('beta')); await until(() => h.turns().length === 3);
      assert.equal(JSON.parse((h.turns()[2]!.params.input as {text:string}[])[0]!.text).pendingRequest, null);
    } finally { await h.close(); }
  }
});

test('discussion controls cannot affect a classifier submitted from another selected project session', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting='automatic'; h.deliveries();
  h.bridge.receive(message('Work alpha')); await until(() => h.turns().length===1);
  h.bridge.receive(message('/chat')); h.deliveries(); h.bridge.receive(message('/status'));
  const status = h.deliveries().join(''); assert.match(status,/暂无任务/); assert.ok(!status.includes('正在理解请求'));
  h.bridge.receive(message('/stop')); h.bridge.receive(message('/补充 Do not modify'));
  assert.ok(!h.codex.calls.some(call => ['turn/steer','turn/interrupt'].includes(call.method)));
  assert.ok(h.state.status(h.session.id).some(row => row.status==='running'));
});

test('process loss before queued clarification starts clears its old authority and retains idle owners', async t => {
  const h = setup(); t.after(h.close); h.config.projectRouting='automatic'; h.deliveries();
  h.bridge.receive(message('Modify alpha')); await until(() => h.turns().length===1); const first=h.current();
  h.codex.complete(first.threadId,first.turnId,'completed',decision('question',null,'Which project?'));
  await until(() => !h.state.directories().length);
  const idle=h.state.select(message('Idle',{user:'ou_idle'}),'beta',h.config.projects.beta!);
  h.state.setRouting(idle.owner,'idle-router','Idle request');
  h.bridge.receive(message('beta, only inspect; do not modify')); h.codex.exit();
  assert.equal(h.state.routing(h.session.owner)!.pending,null); assert.equal(h.state.routing(h.session.owner)!.source,undefined);
  assert.equal(h.state.routing(idle.owner)!.pending,'Idle request');
  assert.equal(h.turns().length,1);
});
