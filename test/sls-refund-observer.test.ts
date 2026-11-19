import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    backlogRun: 'backlog-' + at, recoveryRun: 'recovery-' + at,
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

test('the final slot refuses evidence past the accepted history or reused source batches', t => {
  const first = samples(419);
  const later = samples(1000);
  for (const evidence of [
    samples(1019), { ...later, backlogRun: first.backlogRun }, { ...later, recoveryRun: first.recoveryRun },
  ]) {
    const observer = setup(t).open();
    try {
      observer.acceptWindow(100, 111, [{ id: 'first', at: 110, status: 'firing' }], 120);
      assert.equal(observer.observe(observer.nextSample(420)!, 420, first), true);
      observer.acceptWindow(111, 1005, [{ id: 'latest', at: 1003, status: 'inactive' }], 1020);
      const final = observer.nextSample(1020)!;
      assert.equal(final.evidenceThrough, 1004);
      assert.equal(observer.observe(final, 1020, evidence), true);
      const report = observer.report();
      assert.equal(report.incident?.state, 'needs-attention');
      assert.equal(report.incident?.observations[1]?.evidenceThrough, 1004);
      assert.ok(!JSON.stringify(report).includes('backlog-419'));
    } finally { observer.close(); }
  }
});

test('conflicting samples at the same time are unavailable regardless of result order', () => {
  const scope = 'managed:local_product_order:native_case_refunds';
  const row = (channel: string, pending = 0) => ({
    __time__: '120',
    content: JSON.stringify({
      scope, event: 'merchant_refund_backlog', channel, run_id: 'batch', outcome: 'completed',
      pending, queryable: 0, missing_channel_identity: pending, oldest_age_seconds: pending ? 1000 : 0,
    }),
  });
  const healthy = row('wechat_pay');
  const conflicting = row('wechat_pay', 1);
  const alipay = row('alipay');
  assert.equal(readEvidence(response([healthy, healthy, alipay])).backlog.length, 2);
  for (const data of [[healthy, conflicting, alipay], [alipay, conflicting, healthy]]) {
    assert.deepEqual(readEvidence(response(data)), { backlog: [], unavailable: 'invalid-or-incomplete-source' });
  }
});

test('late firings before confirmed recovery stay on the resolved incident boundary', t => {
  for (const invalidates of [false, true]) {
    const { open } = setup(t);
    const observer = open();
    try {
      observer.acceptWindow(100, 121, [{ id: 'initial', at: 110, status: 'firing' }], 120 + 1);
      observer.observe(observer.nextSample(421)!, 421, samples(419));
      observer.acceptWindow(121, 1005, [{ id: 'inactive', at: 1003, status: 'inactive' }], 1020);
      observer.observe(observer.nextSample(1021)!, 1021, samples(1000));
      const original = observer.report().incident!;
      assert.equal(original.state, 'resolved');
      observer.acceptWindow(100, 1025, [{ id: 'delayed', at: invalidates ? 500 : 140, status: 'firing' }], 1025);
      assert.equal(observer.report().evaluations, 3);
      assert.equal(observer.report().incident?.id, original.id);
      assert.equal(observer.report().incident?.state, invalidates ? 'needs-attention' : 'resolved');
      if (!invalidates) {
        observer.acceptWindow(1025, 1090, [{ id: 'new', at: 1080, status: 'firing' }], 1100);
        assert.notEqual(observer.report().incident?.id, original.id);
        assert.equal(observer.report().incident?.state, 'open');
      }
    } finally { observer.close(); }
  }
});

test('a same-second conflict invalidates the inactive evaluation in either arrival order', t => {
  for (const late of [false, true]) {
    const observer = setup(t).open();
    try {
      observer.acceptWindow(100, 121, [{ id: 'fire', at: 110, status: 'firing' }], 121);
      observer.observe(observer.nextSample(421)!, 421, samples(419));
      const quiet = { id: 'quiet', at: 1003, status: 'inactive' } as const;
      const error = { id: 'error', at: 1003, status: 'error' } as const;
      observer.acceptWindow(121, 1005, late ? [quiet] : [quiet, error], 1020);
      observer.observe(observer.nextSample(1021)!, 1021, samples(1000));
      const id = observer.report().incident!.id;
      if (late) {
        assert.equal(observer.report().incident?.state, 'resolved');
        observer.acceptWindow(990, 1026, [error], 1026);
      }
      const after = observer.report().incident!;
      assert.equal(after.state, 'needs-attention');
      assert.equal(after.id, id);
      assert.equal(after.lastFiring, 110);
      assert.deepEqual(after.observations.map(sample => sample.slot), [1, 2]);
    } finally { observer.close(); }
  }
});

test('a delayed closure conflict flags the original incident while a newer schedule keeps running', t => {
  const { open } = setup(t);
  const first = open();
  let original: string;
  let current: string;
  try {
    first.acceptWindow(100, 121, [{ id: 'fire-a', at: 110, status: 'firing' }], 121);
    first.observe(first.nextSample(421)!, 421, samples(419));
    first.acceptWindow(121, 1005, [{ id: 'quiet-a', at: 1003, status: 'inactive' }], 1020);
    first.observe(first.nextSample(1021)!, 1021, samples(1000));
    original = first.report().incident!.id;
    assert.equal(first.report().incident?.state, 'resolved');
    first.acceptWindow(1005, 1022, [{ id: 'fire-b', at: 1010, status: 'firing' }], 1025);
    current = first.report().incident!.id;
    assert.notEqual(original, current);
  } finally { first.close(); }

  const reopened = open();
  try {
    const schedule = reopened.nextSample(1030);
    reopened.acceptWindow(995, 1026, [{ id: 'delayed-conflict-a', at: 1003, status: 'error' }], 1030);
    const report = reopened.report();
    assert.equal(report.incident?.id, current);
    assert.equal(report.incident?.state, 'open');
    assert.deepEqual(reopened.nextSample(1030), schedule);
    assert.deepEqual(report.handoffs.map(handoff => handoff.id), [original]);
  } finally { reopened.close(); }
});

test('tied monitor runs and contradictory terminal outcomes identify source conflicts', () => {
  const scope = 'managed:local_product_order:native_case_refunds';
  const row = (body: Record<string, unknown>) => ({ __time__: '120', content: JSON.stringify({ scope, ...body }) });
  const terminal = (outcome: string) => row({ event: 'merchant_refund_recovery', outcome, run_id: 'recovery',
    query_errors: outcome === 'completed' ? 0 : 1, deferred: 0 });
  const backlog = (run: string, channel: string) => row({ event: 'merchant_refund_backlog', outcome: 'completed',
    channel, run_id: run, pending: 0, queryable: 0, missing_channel_identity: 0, oldest_age_seconds: 0 });
  assert.equal(readEvidence(response([terminal('completed'), terminal('completed')])).recovery?.outcome, 'completed');
  for (const data of [[backlog('a', 'wechat_pay'), backlog('b', 'alipay')],
    [terminal('completed'), terminal('degraded')]]) {
    assert.equal(readEvidence(response(data)).unavailable, 'invalid-or-incomplete-source');
    assert.equal(readEvidence(response([...data].reverse())).unavailable, 'invalid-or-incomplete-source');
  }
});

test('CLI preserves the cursor on incomplete history and records sanitized diagnostic transport errors', t => {
  const { directory } = setup(t);
  const mock = join(directory, 'aliyun');
  const cfg = join(directory, 'config.json');
  const trace = join(directory, 'trace.jsonl');
  const scenario = join(directory, 'scenario');
  const state = join(directory, 'state');
  const now = Math.floor(Date.now() / 1000);
  const start = now - 360;
  writeFileSync(mock, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + String.fromCharCode(10));
const body = JSON.parse(args.at(-1));
const store = args[args.indexOf('--logstore') + 1];
const setting = fs.readFileSync(${JSON.stringify(scenario)}, 'utf8');
if (store === 'service-runtime') {
  if (setting === 'Malformed') {
    console.log('PRIVATE_MALFORMED_OUTPUT');
    process.exit(0);
  }
  console.error('PRIVATE_PROVIDER_DIAGNOSTIC');
  process.exit(9);
}
const progress = setting === 'Malformed' ? 'Complete' : setting;
const entries = [{ AlertID: 'same-event', AlertName: 'refund-rule', AlertStatus: 'firing', __time__: String(body.from + 10) }];
console.log(JSON.stringify({ meta: {progress,isAccurate:true,count:entries.length}, data:entries }));
`, { mode: 0o700 });
  writeFileSync(cfg, JSON.stringify({ region: binding.region, project: binding.project, rule: binding.rule, start,
    executable: mock, profile: 'fixture-profile' }));
  const cli = (command: string, file = cfg, database = state) => spawnSync(process.execPath,
    ['--import', 'tsx', 'src/sls-refund/cli.ts', command, database, file], { encoding: 'utf8' });
  writeFileSync(scenario, 'Incomplete');
  const incomplete = cli('observe');
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /incomplete/);
  const persisted = new RefundObserver(state, { ...binding, mode: 'live', start });
  try { assert.equal(persisted.through(), start); }
  finally { persisted.close(); }

  writeFileSync(scenario, 'Complete');
  const accepted = cli('observe');
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.ok(!accepted.stderr.includes('PRIVATE_PROVIDER_DIAGNOSTIC'));
  const report = JSON.parse(accepted.stdout);
  assert.equal(report.incident.observations[0].reason, 'source-query-failed');
  const calls: string[][] = readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(args => args.slice(0, -1)), [
    ['sls', 'GetLogsV2', '--profile', 'fixture-profile', '--project', 'fixture', '--logstore', 'internal-alert-history', '--region', 'cn-hangzhou', '--body'],
    ['sls', 'GetLogsV2', '--profile', 'fixture-profile', '--project', 'fixture', '--logstore', 'internal-alert-history', '--region', 'cn-hangzhou', '--body'],
    ['sls', 'GetLogsV2', '--profile', 'fixture-profile', '--project', 'fixture', '--logstore', 'service-runtime', '--region', 'cn-hangzhou', '--body'],
  ]);
  assert.equal(JSON.parse(calls[1]!.at(-1)!).query, 'AlertName: "refund-rule"');
  assert.equal(JSON.parse(calls[2]!.at(-1)!).query, '"merchant_refund_backlog" OR "merchant_refund_recovery"');
  const failedRead = cli('replay', join(directory, 'PRIVATE_INPUT_PATH'));
  assert.equal(failedRead.status, 1);
  assert.ok(!failedRead.stderr.includes('PRIVATE_INPUT_PATH'));
  assert.match(failedRead.stderr, /input could not be read/);

  writeFileSync(scenario, 'Malformed');
  const malformed = cli('observe', cfg, join(directory, 'malformed-state'));
  assert.equal(malformed.status, 0, malformed.stderr);
  assert.ok(!(malformed.stdout + malformed.stderr).includes('PRIVATE_MALFORMED_OUTPUT'));
  assert.equal(JSON.parse(malformed.stdout).incident.observations[0].reason, 'invalid-or-incomplete-source');
});
