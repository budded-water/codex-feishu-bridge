import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Feishu, FEISHU_START_TIMEOUT_MS } from '../src/feishu.js';

function socket(adapter: Feishu) {
  return Reflect.get(adapter, 'socket') as {
    start: (...args: unknown[]) => Promise<void>;
    onReady: () => void;
    onError: (error: Error) => void;
    onReconnecting: () => void;
  };
}

test('startup waits for readiness and later terminal failures notify lifecycle once', async t => {
  const adapter = new Feishu({ appId: 'cli_' + '0'.repeat(16), appSecret: 'fictional-secret' });
  t.after(() => adapter.close());
  const ws = socket(adapter); t.mock.method(ws, 'start', async () => {});
  let failures = 0; adapter.onFailure(() => { failures++; });
  let ready = false;
  const startup = adapter.start(() => {}).then(() => { ready = true; });
  await setImmediate(); assert.equal(ready, false);
  ws.onReady(); await startup; assert.equal(ready, true);
  ws.onReconnecting(); assert.equal(failures, 0);
  ws.onError(new Error('private SDK details')); assert.equal(failures, 1);
  ws.onError(new Error('duplicate terminal error')); assert.equal(failures, 1);
});

test('terminal startup failures reject without publishing raw SDK details', async t => {
  const adapter = new Feishu({ appId: 'cli_' + '0'.repeat(16), appSecret: 'fictional-secret' });
  t.after(() => adapter.close());
  const ws = socket(adapter);
  const errors: string[] = []; t.mock.method(console, 'error', (value: string) => { errors.push(value); });
  t.mock.method(ws, 'start', async () => { queueMicrotask(() => ws.onError(new Error('private credential details'))); });
  await assert.rejects(adapter.start(() => {}), /no live message connection/);
  assert.ok(errors.length > 0); assert.ok(errors.every(value => !value.includes('private credential')));
});

test('startup without an SDK readiness event has a bounded failure', async t => {
  const adapter = new Feishu({ appId: 'cli_' + '0'.repeat(16), appSecret: 'fictional-secret' });
  t.after(() => adapter.close());
  t.mock.method(socket(adapter), 'start', async () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const startup = adapter.start(() => {});
  t.mock.timers.tick(FEISHU_START_TIMEOUT_MS);
  await assert.rejects(startup, /no live message connection/);
});

test('closing a pending connection rejects startup without firing failure listeners', async t => {
  const adapter = new Feishu({ appId: 'cli_' + '0'.repeat(16), appSecret: 'fictional-secret' });
  t.after(() => adapter.close());
  t.mock.method(socket(adapter), 'start', async () => {});
  let failures = 0; adapter.onFailure(() => { failures++; });
  const startup = adapter.start(() => {});
  adapter.close();
  await assert.rejects(startup, /connection stopped/);
  assert.equal(failures, 0);
});


test('closing during group identity lookup cannot resurrect an SDK connection', async t => {
  const adapter = new Feishu({ appId: 'cli_' + '0'.repeat(16), appSecret: 'fictional-secret' }, true);
  t.after(() => adapter.close());
  let resolve!: (response: unknown) => void;
  Object.assign(adapter, { client: { request: () => new Promise(done => { resolve = done; }) } });
  const start = t.mock.method(socket(adapter), 'start', async () => {});
  const startup = adapter.start(() => {});
  adapter.close(); resolve({ code: 0, bot: { open_id: 'ou_fictional_bot' } });
  await assert.rejects(startup, /connection stopped/);
  assert.equal(start.mock.callCount(), 0);
});
