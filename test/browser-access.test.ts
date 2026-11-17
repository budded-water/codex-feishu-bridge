import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { browserAccessDenial, parseBrowserAccessBlock } from '../src/browser-access.js';

const sample = () => JSON.parse(readFileSync(new URL('./fixtures/browser-saved-denial.json', import.meta.url), 'utf8'));

test('real Browser Use metadata shape yields only canonical origin and bounded provider evidence', () => {
  assert.deepEqual(browserAccessDenial(sample()), { item: 'browser-denial-item', origin: 'https://console.example.com', browser: 'chrome', code: 'persisted_user_denied' });
  const json = JSON.stringify(browserAccessDenial(sample()));
  assert.ok(!json.includes('fixture-secret') && !json.includes('/private') && !json.includes('arguments') && !json.includes('content'));
});

test('prose, unrelated servers, different failures and invalid target URLs do not become browser policy observations', () => {
  const variants = [
    (x: ReturnType<typeof sample>) => { x.server = 'other'; },
    (x: ReturnType<typeof sample>) => { x.tool = 'other'; },
    (x: ReturnType<typeof sample>) => { x.type = 'agentMessage'; },
    (x: ReturnType<typeof sample>) => { x.status = 'completed'; },
    (x: ReturnType<typeof sample>) => { delete x.result._meta; },
    (x: ReturnType<typeof sample>) => { x.result._meta['codex/browserUse'] = false; },
    (x: ReturnType<typeof sample>) => { x.result._meta['codex/toolSurface'].kind = 'other'; },
    (x: ReturnType<typeof sample>) => { x.result._meta['codex/telemetry'].error_code = 'execution_timeout'; },
    (x: ReturnType<typeof sample>) => { x.result._meta['codex/toolSurface'].browserFamily = 'x\nforged'; },
  ];
  for (const change of variants) { const x = sample(); change(x); assert.equal(browserAccessDenial(x), undefined); }
  for (const target of [undefined, '', 'not-url', 'file:///private/file', 'javascript:alert(1)', 'https://user:pass@example.com/', ' https://example.com', 'https://example.com/\nsecret']) {
    const x = sample(); x.result._meta.browser_use.url = target; assert.equal(browserAccessDenial(x), undefined);
  }
});

test('stored and IPC observations require full typed identity, canonical origin and valid observed time', () => {
  const value = { ...browserAccessDenial(sample())!, task: 'task', generation: 'generation', observedAt: Date.now() };
  assert.deepEqual(parseBrowserAccessBlock(value), value);
  for (const changed of [{ origin: undefined }, { origin: 'https://example.com/path' }, { origin: 'https://user:pass@example.com' }, { task: '' }, { generation: '' },
    { item: '' }, { code: 'approved' }, { observedAt: NaN }, { observedAt: 0 }, { browser: '<forged>' }]) assert.throws(() => parseBrowserAccessBlock({ ...value, ...changed }));
});
