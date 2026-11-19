import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { channels, RefundObserver, type Binding, type Evidence } from '../src/sls-refund/observer.js';
import { parseObserverConfig, readEvaluations, readEvidence } from '../src/sls-refund/sls-source.js';

const binding: Binding = { mode: 'replay', region: 'cn-hangzhou', project: 'fixture', rule: 'refund-rule', start: 100 };
function setup(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'refund-observer-'));
  const open = () => new RefundObserver(directory, binding);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, open };
}
function samples(at: number, oldestSeconds = 0, missing = 0): Evidence {
  return {
    backlog: channels.map((channel, i) => ({
      channel, at, pending: i ? 0 : Number(oldestSeconds > 0) + missing, queryable: i ? 0 : Number(oldestSeconds > 0),
      missing: i ? 0 : missing, oldestSeconds: i ? 0 : oldestSeconds,
    })),
    recovery: { at, outcome: 'completed', queryErrors: 0, deferred: 0 },
  };
}
function response(data: Record<string, unknown>[], progress = 'Complete') {
  return { meta: { progress, isAccurate: true, count: data.length }, data };
}

test('sanitized replay retains one incident across duplicate evaluation windows and physical reopen', t => {
  const directory = setup(t).directory;
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/sls-refund-replay.json', import.meta.url), 'utf8'));
  const { binding } = parseObserverConfig(fixture.source, 'replay');
  let incidentId: string | undefined;
  for (const frame of fixture.frames) {
    const observer = new RefundObserver(directory, binding);
    try {
      observer.acceptWindow(frame.from, frame.to, readEvaluations(frame.evaluations, binding), frame.now);
      const incident = observer.report().incident!;
      if (incidentId) assert.equal(incident.id, incidentId);
      else incidentId = incident.id;
      const due = observer.nextSample(frame.now);
      if (due) assert.equal(observer.observe(due, frame.now, readEvidence(frame.evidence)), true);
    } finally { observer.close(); }
  }
  const reopened = new RefundObserver(directory, binding);
  try {
    const report = reopened.report();
    assert.equal(report.mode, 'replay');
    assert.equal(report.evaluations, 4);
    assert.equal(report.incident?.state, 'resolved');
    assert.equal(report.incident?.observations.length, 3);
    assert.deepEqual(report.incident?.observations[0]?.signals, ['aged-backlog']);
    assert.deepEqual(report.incident?.observations.slice(1).map(item => item.state), ['healthy', 'healthy']);
    assert.throws(() => new RefundObserver(directory, { ...binding, mode: 'live' }), /different source/);
  } finally { reopened.close(); }
});

test('changed evaluation identity rolls back a window and late overlaps do not create another incident', t => {
  const observer = setup(t).open();
  try {
    observer.acceptWindow(100, 150, [{ id: 'firing', at: 120, status: 'firing' }], 160);
    const original = observer.report();
    assert.throws(() => observer.acceptWindow(115, 250, [
      { id: 'new', at: 119, status: 'firing' },
      { id: 'firing', at: 120, status: 'inactive' },
    ], 250), /changed its meaning/);
    assert.deepEqual(observer.report(), original);
    observer.acceptWindow(115, 220, [{ id: 'late', at: 118, status: 'firing' }], 220);
    assert.equal(observer.report().evaluations, 2);
    assert.equal(observer.report().incident?.lastFiring, 120);
    assert.throws(() => observer.acceptWindow(221, 240, [], 241), /skip unread history/);
  } finally { observer.close(); }
});

test('missing identity, both predicates and incomplete observations have distinct outcomes', t => {
  const cases = [
    { evidence: samples(151, 0, 1), state: 'issue', signals: ['missing-channel-identity'] },
    { evidence: samples(151, 950, 1), state: 'issue', signals: ['aged-backlog', 'missing-channel-identity'] },
    { evidence: samples(149), state: 'unavailable', signals: [] },
    { evidence: { backlog: [] }, state: 'unavailable', signals: [] },
    { evidence: { ...samples(151), recovery: { at: 151, outcome: 'degraded' as const, queryErrors: 1, deferred: 0 } },
      state: 'issue', signals: ['recovery-job-unhealthy'] },
  ];
  for (const item of cases) {
    const observer = setup(t).open();
    try {
      observer.acceptWindow(100, 151, [{ id: 'first', at: 150, status: 'firing' }], 155);
      observer.observe(observer.nextSample(155)!, 155, item.evidence);
      const observed = observer.report().incident?.observations[0];
      assert.equal(observed?.state, item.state);
      assert.deepEqual(observed?.signals, item.signals);
    } finally { observer.close(); }
  }
});

test('an intervening firing invalidates old clean evidence and missed checks are not replayed', t => {
  const observer = setup(t).open();
  try {
    observer.acceptWindow(100, 111, [{ id: 'first', at: 110, status: 'firing' }], 120);
    const due = observer.nextSample(420)!;
    assert.equal(due.slot, 1);
    assert.equal(observer.observe(due, 420, samples(419)), true);
    assert.equal(observer.observe(due, 420, samples(419)), false);
    observer.acceptWindow(110, 650, [{ id: 'recurrence', at: 640, status: 'firing' }], 650);
    const final = observer.nextSample(1020)!;
    assert.equal(final.slot, 2);
    assert.equal(observer.observe(final, 1020, samples(1019)), true);
    assert.equal(observer.report().incident?.state, 'needs-attention');
    assert.deepEqual(observer.report().incident?.observations.map(row => row.slot), [1, 2]);
    assert.equal(observer.nextSample(2000), undefined);
  } finally { observer.close(); }
});

test('a late unseen firing is retained and a paused rule cannot close an otherwise healthy incident', t => {
  const observer = setup(t).open();
  try {
    observer.acceptWindow(100, 151, [{ id: 'quiet', at: 149, status: 'inactive' }], 160);
    observer.acceptWindow(120, 180, [{ id: 'delayed', at: 140, status: 'firing' }], 190);
    assert.equal(observer.report().incident?.lastFiring, 140);
    observer.observe(observer.nextSample(490)!, 490, samples(489));
    observer.acceptWindow(180, 1070, [{ id: 'paused', at: 1065, status: 'paused' }], 1080);
    observer.observe(observer.nextSample(1090)!, 1090, samples(1089));
    assert.equal(observer.report().incident?.state, 'needs-attention');
    assert.equal(observer.report().latestEvaluation?.status, 'paused');
  } finally { observer.close(); }
});

test('provider scope, response completeness and row budget are checked before admission', () => {
  const good = { AlertID: 'one', AlertName: binding.rule, AlertStatus: 'firing', __time__: '120' };
  assert.deepEqual(readEvaluations(response([good]), binding), [{ id: 'one', at: 120, status: 'firing' }]);
  assert.throws(() => readEvaluations(response([good], 'Incomplete'), binding), /incomplete/);
  assert.throws(() => readEvaluations(response(Array(100).fill(good)), binding), /query limit/);
  assert.throws(() => readEvaluations(response([{ ...good, AlertName: 'different' }]), binding), /outside/);
  assert.throws(() => readEvaluations(response([{ ...good, __time__: 'bad' }]), binding), /Invalid SLS/);
});

test('the observer never combines channels from different monitor runs or reports a failed latest run as complete', () => {
  const scope = 'managed:local_product_order:native_case_refunds';
  const sample = (channel: string, run: string, at: number) => ({
    __time__: String(at),
    content: '2026-11-18T08:45:24Z stdout F ' + JSON.stringify({
      scope, event: 'merchant_refund_backlog', channel, run_id: run, outcome: 'completed',
      pending: 0, queryable: 0, missing_channel_identity: 0, oldest_age_seconds: 0,
    }),
  });
  const old = [sample('wechat_pay', 'first', 100), sample('alipay', 'first', 100)];
  assert.equal(readEvidence(response([...old, sample('wechat_pay', 'second', 110)])).backlog.length, 1);
  assert.deepEqual(readEvidence(response([...old, { __time__: '120',
    content: JSON.stringify({ scope, event: 'merchant_refund_backlog', outcome: 'failed' }) }])).backlog, []);
});
