import { spawnSync } from 'node:child_process';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { channels, RefundObserver, type Binding, type Evidence } from '../src/sls-refund/observer.js';
import { pollRefundObserver } from '../src/sls-refund/poll.js';
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

test('a new firing after a late inactive boundary gets its own incident after a published human handoff', t => {
  const { open } = setup(t);
  const observer = open();
  let handled: string;
  try {
    observer.acceptWindow(100, 151, [{ id: 'first-firing', at: 120, status: 'firing' }], 160);
    assert.ok(observer.observe(observer.nextSample(1060)!, 1060, { backlog: [] }));
    const notice = observer.pendingNotices()[0]!;
    assert.equal(notice.state, 'needs-attention');
    handled = notice.incident;
    observer.noticeProjected(notice.card);
  } finally { observer.close(); }

  const reopened = open();
  try {
    reopened.acceptWindow(151, 1151, [
      { id: 'continuing-firing', at: 1080, status: 'firing' },
      { id: 'new-firing', at: 1140, status: 'firing' },
    ], 1160);
    assert.equal(reopened.pendingNotices().length, 0);
    assert.equal(reopened.nextSample(1160), undefined);
    const overlap = [
      { id: 'quiet', at: 1110, status: 'inactive' },
      { id: 'later-quiet', at: 1170, status: 'inactive' },
      { id: 'later-firing', at: 1200, status: 'firing' },
    ] as const;
    reopened.acceptWindow(1100, 1211, [...overlap], 1220);
    const next = reopened.pendingNotices()[0]!;
    assert.equal(next.state, 'open');
    assert.notEqual(next.incident, handled);
    assert.equal(reopened.nextSample(1220)?.incident, next.incident);
    assert.equal(reopened.report().incident?.opened, 1140);
    assert.equal(reopened.report().incident?.lastFiring, 1200);
    reopened.acceptWindow(1100, 1211, [...overlap], 1230);
    assert.deepEqual(reopened.pendingNotices(), [next]);
    assert.deepEqual({ ...reopened.report().handoffs[0] }, { id: handled, opened: 120, lastFiring: 1080 });
  } finally { reopened.close(); }
});

test('a delayed queue firing after a human handoff preserves unread history needed to separate episodes', t => {
  const { open } = setup(t);
  const observer = open();
  try {
    observer.acceptWindow(100, 151, [{ id: 'first-firing', at: 120, status: 'firing' }], 160);
    assert.ok(observer.observe(observer.nextSample(1060)!, 1060, { backlog: [] }));
    assert.equal(observer.report().incident?.state, 'needs-attention');
    const handedOff = observer.report().incident!.id;
    observer.retainNotification({ id: 'later-queued-firing', at: 1140 }, 2000);
    assert.equal(observer.discoveryCursor(), 151);
    observer.acceptWindow(151, 600, [{ id: 'intervening-inactive', at: 500, status: 'inactive' }], 2000);
    const current = observer.report().incident!;
    assert.notEqual(current.id, handedOff);
    assert.equal(current.state, 'open');
    assert.equal(current.opened, 1140);
    assert.equal(observer.report().handoffs[0]?.id, handedOff);
  } finally { observer.close(); }
});

test('existing subscription state migrates the idle floor without breaking the previous observer initializer', t => {
  const { directory, open } = setup(t);
  const observer = open();
  observer.retainNotification({ id: 'original', at: 120 }, 500);
  const incident = observer.report().incident!.id;
  observer.close();

  const path = join(directory, 'refund-observer.db');
  let db = new DatabaseSync(path);
  db.exec(`ALTER TABLE source ADD COLUMN idle_floor INTEGER;
    UPDATE source SET idle_floor=380;
    DROP TABLE IF EXISTS refund_subscription;`);
  db.close();

  const upgraded = open();
  try {
    assert.equal(upgraded.discoveryCursor(), 380);
    assert.equal(upgraded.through(), 100);
    assert.equal(upgraded.report().incident?.id, incident);
    assert.equal(upgraded.notificationReadDue(400), true);
  } finally { upgraded.close(); }

  db = new DatabaseSync(path);
  try {
    const previousInsert = db.prepare('INSERT OR IGNORE INTO source VALUES (1,?,?)');
    assert.equal(previousInsert.run('previous observer', 100).changes, 0);
  } finally { db.close(); }
});

test('migrating a legacy handoff discards the idle floor so the next firing finds its separating evaluation', t => {
  const { directory, open } = setup(t);
  const observer = open();
  observer.acceptWindow(100, 151, [{ id: 'first', at: 120, status: 'firing' }], 160);
  observer.observe(observer.nextSample(1060)!, 1060, { backlog: [] });
  const handedOff = observer.report().incident!.id;
  observer.close();

  const legacy = new DatabaseSync(join(directory, 'refund-observer.db'));
  legacy.exec('ALTER TABLE source ADD COLUMN idle_floor INTEGER; UPDATE source SET idle_floor=4500;');
  legacy.close();
  const upgraded = open();
  t.after(() => upgraded.close());
  upgraded.retainNotification({ id: 'new-episode', at: 5010 }, 5100);
  assert.equal(upgraded.discoveryCursor(), 151);
  upgraded.acceptWindow(151, 1051, [{ id: 'separating-quiet', at: 500, status: 'inactive' }], 5100);
  assert.notEqual(upgraded.report().incident?.id, handedOff);
  assert.equal(upgraded.report().incident?.opened, 5010);
});

test('a delayed subscription catch-up after human handoff preserves the new incident observation budget', async t => {
  const observer = setup(t).open();
  t.after(() => observer.close());
  observer.acceptWindow(100, 151, [{ id: 'first', at: 120, status: 'firing' }], 160);
  assert.ok(observer.observe(observer.nextSample(1060)!, 1060, { backlog: [] }));
  const previous = observer.report().incident!.id;
  observer.retainNotification({ id: 'new-episode', at: 6000 }, 6100);
  let evidenceReads = 0;
  const poll = (now: number) => pollRefundObserver(observer, { binding }, {
    now, subscription: true, read: async (_config, kind, from, to) => {
      if (kind === 'evidence') evidenceReads++;
      return JSON.stringify(response(kind === 'evaluations' && from <= 500 && to > 500
        ? [{ AlertID: 'quiet', AlertName: binding.rule, AlertStatus: 'inactive', __time__: '500' }] : []));
    },
  });
  assert.equal(await poll(6100), false);
  assert.notEqual(observer.report().incident?.id, previous);
  assert.equal(evidenceReads, 0);
  for (let window = 0; window < 6; window++) assert.equal(await poll(7300), false);
  assert.equal(await poll(7300), true);
  assert.equal(evidenceReads, 1);
  assert.equal(observer.report().incident?.state, 'open');
  assert.deepEqual(observer.report().incident?.observations.map(row => row.slot), [0]);
  assert.deepEqual(observer.report().incident?.followups, [7600, 8200]);
  assert.equal(observer.notificationReadDue(7300), false);
});

test('subscription schedules one persisted closure overlap that can undo a delivered recovery', async t => {
  const { open } = setup(t);
  const initial = open();
  let incident: string;
  try {
    initial.acceptWindow(100, 121, [{ id: 'fire', at: 110, status: 'firing' }], 121);
    initial.observe(initial.nextSample(421)!, 421, samples(419));
    initial.acceptWindow(121, 1005, [{ id: 'quiet', at: 1003, status: 'inactive' }], 1065);
    const scope = 'managed:local_product_order:native_case_refunds';
    const evidence = [
      ...channels.map(channel => ({ event: 'merchant_refund_backlog', channel, run_id: 'new-backlog',
        outcome: 'completed', pending: 0, queryable: 0, missing_channel_identity: 0, oldest_age_seconds: 0 })),
      { event: 'merchant_refund_recovery', run_id: 'new-recovery', outcome: 'completed', query_errors: 0, deferred: 0 },
    ].map(row => ({ __time__: '1000', content: JSON.stringify({ scope, ...row }) }));
    await pollRefundObserver(initial, { binding }, { now: 1065, subscription: true, read: async (_config, kind) => {
      assert.equal(kind, 'evidence');
      return JSON.stringify(response(evidence));
    } });
    const card = initial.pendingNotices()[0]!;
    assert.equal(card.state, 'resolved');
    incident = card.incident;
    initial.noticeProjected(card.card);
  } finally { initial.close(); }

  const reopened = open();
  t.after(() => reopened.close());
  const calls: [string, number, number][] = [];
  const poll = (now: number) => pollRefundObserver(reopened, { binding }, { now, subscription: true,
    read: async (_config, kind, from, to) => {
      calls.push([kind, from, to]);
      return JSON.stringify(response([{ AlertID: 'late-firing', AlertName: binding.rule, AlertStatus: 'firing', __time__: '850' }]));
    },
  });
  await poll(1184);
  assert.equal(calls.length, 0);
  await poll(2000);
  assert.deepEqual(calls, [['evaluations', 419, 1004]]);
  assert.equal(reopened.through(), 1005);
  assert.equal(reopened.report().incident?.id, incident);
  assert.equal(reopened.pendingNotices()[0]?.state, 'needs-attention');
  await poll(3000);
  assert.equal(calls.length, 1);
});

test('a recently queued firing waits for ingested history before its first sample and deadlines', async t => {
  const observer = setup(t).open();
  t.after(() => observer.close());
  observer.retainNotification({ id: 'fresh', at: 490 }, 500);
  const calls: string[] = [];
  const poll = (now: number) => pollRefundObserver(observer, { binding }, { now, subscription: true,
    read: async (_config, kind) => {
      calls.push(kind);
      return JSON.stringify(response([]));
    },
  });
  await poll(550);
  assert.deepEqual(calls, []);
  assert.deepEqual(observer.report().incident?.observations, []);
  await poll(551);
  assert.deepEqual(calls, ['evaluations', 'evidence']);
  assert.equal(observer.report().incident?.observations[0]?.observed, 551);
  assert.deepEqual(observer.report().incident?.followups, [851, 1451]);
});

test('a queued firing that invalidates recovery retains history for a separate new incident', t => {
  const observer = setup(t).open();
  t.after(() => observer.close());
  observer.acceptWindow(100, 121, [{ id: 'initial', at: 110, status: 'firing' }], 121);
  observer.observe(observer.nextSample(421)!, 421, samples(419));
  observer.acceptWindow(121, 1005, [{ id: 'quiet', at: 1003, status: 'inactive' }], 1065);
  observer.observe(observer.nextSample(1065)!, 1065, samples(1000));
  const closed = observer.report().incident!.id;
  assert.equal(observer.report().incident?.state, 'resolved');
  observer.retainNotification({ id: 'late-conflict', at: 1003 }, 5100);
  assert.equal(observer.report().incident?.id, closed);
  assert.equal(observer.report().incident?.state, 'needs-attention');
  observer.retainNotification({ id: 'new-episode', at: 5010 }, 5100);
  assert.equal(observer.discoveryCursor(), 1005);
  observer.acceptWindow(1005, 1905, [{ id: 'separating-inactive', at: 1100, status: 'inactive' }], 5100);
  assert.notEqual(observer.report().incident?.id, closed);
  assert.equal(observer.report().incident?.opened, 5010);
  assert.equal(observer.report().handoffs[0]?.id, closed);
});

test('a scheduled poll after disabling the subscription reads from the saved SLS cursor', async t => {
  const { open } = setup(t);
  const subscribed = open();
  subscribed.retainNotification({ id: 'queued', at: 390 }, 500);
  assert.equal(subscribed.discoveryCursor(), 380);
  subscribed.close();

  const observer = open();
  t.after(() => observer.close());
  const poll = () => pollRefundObserver(observer, { binding }, { now: 2000, read: async (_config, kind, from, to) => {
    if (kind === 'evidence') return JSON.stringify(response([]));
    if (from === 100) {
      assert.equal(to, 1000);
      return JSON.stringify(response([{ AlertID: 'previous', AlertName: binding.rule, AlertStatus: 'inactive', __time__: '200' }]));
    }
    return JSON.stringify(response([]));
  } });
  assert.equal(await poll(), false);
  assert.equal(await poll(), false);
  assert.equal(await poll(), true);
  assert.equal(observer.through(), 1940);
  assert.equal(observer.report().evaluations, 2);
  assert.deepEqual(observer.report().incident?.observations.map(row => row.slot), [0]);
  assert.deepEqual(observer.report().incident?.followups, [2300, 2900]);
});

test('the final query supplements only the missing channel of the same batch without using it for recovery', async t => {
  const scope = 'managed:local_product_order:native_case_refunds';
  const entry = (at: number, content: Record<string, unknown>) => ({ __time__: String(at), content: JSON.stringify({ scope, ...content }) });
  const backlog = (channel: string, at: number, run: string) => entry(at, {
    event: 'merchant_refund_backlog', channel, run_id: run, outcome: 'completed',
    pending: 0, queryable: 0, missing_channel_identity: 0, oldest_age_seconds: 0,
  });
  const original = response([backlog('alipay', 1000, 'cutoff-batch'), entry(1001, {
    event: 'merchant_refund_recovery', run_id: 'healthy-final', outcome: 'completed', query_errors: 0, deferred: 0,
  })]);
  const same = backlog('wechat_pay', 1007, 'cutoff-batch');
  const other = backlog('wechat_pay', 1009, 'another-batch');
  const unboundFailure = entry(1008, { event: 'merchant_refund_backlog', outcome: 'failed' });
  const conflictingRecovery = entry(1001, {
    event: 'merchant_refund_recovery', run_id: 'healthy-final', outcome: 'degraded', query_errors: 1, deferred: 0,
  });

  for (const scenario of [
    { name: 'matched despite a later unrelated batch', status: 'matched', extra: response([same, other]) },
    { name: 'matched beside contradictory recovery reports', status: 'matched', extra: response([same]),
      primary: response([...original.data, conflictingRecovery]) },
    { name: 'unrelated batch alone', status: 'not-found', extra: response([other]) },
    { name: 'incomplete source', status: 'unavailable', extra: response([same], 'Incomplete') },
    { name: 'unidentifiable backlog failure', status: 'unavailable', extra: response([same, unboundFailure]) },
    { name: 'out-of-window record', status: 'unavailable', extra: response([backlog('wechat_pay', 1019, 'cutoff-batch')]) },
    { name: 'maintenance', status: undefined, extra: response([same]) },
  ]) await t.test(scenario.name, async t => {
    const { open } = setup(t);
    const observer = open();
    try {
      observer.acceptWindow(100, 121, [{ id: 'fire', at: 110, status: 'firing' }], 121);
      observer.observe(observer.nextSample(421)!, 421, samples(419));
      observer.acceptWindow(121, 1005, [{ id: 'quiet', at: 1003, status: 'inactive' }], 1065);
      const queries: [number, number][] = [];
      let allowed = true;
      await pollRefundObserver(observer, { binding }, { now: 1065, subscription: true, canContinue: () => allowed,
        read: async (_cfg, kind, from, to) => {
          assert.equal(kind, 'evidence');
          queries.push([from, to]);
          if (to === 1004) {
            if (scenario.name === 'maintenance') allowed = false;
            return JSON.stringify(scenario.primary ?? original);
          }
          return JSON.stringify(scenario.extra);
        },
      });
      assert.deepEqual(queries, scenario.status ? [[765, 1004], [1004, 1019]] : [[765, 1004]]);
    } finally { observer.close(); }

    const reopened = open();
    try {
      const incident = reopened.report().incident!;
      const final = incident.observations.at(-1)!;
      assert.equal(incident.state, 'needs-attention');
      assert.equal(final.evidenceThrough, 1004);
      assert.equal(final.state, 'unavailable');
      assert.deepEqual(final.evidence.backlog.map(row => row.channel), ['alipay']);
      assert.equal(final.backlogSupplement?.status, scenario.status);
      assert.deepEqual(final.backlogSupplement?.status === 'matched' ? final.backlogSupplement.row : undefined,
        scenario.status === 'matched' ? { ...samples(1007).backlog[0], channel: 'wechat_pay' } : undefined);
      assert.equal(reopened.nextClosureCheck(6000), undefined);
      assert.doesNotMatch(JSON.stringify(final), /cutoff-batch|another-batch|healthy-final/);
    } finally { reopened.close(); }
  });
});
