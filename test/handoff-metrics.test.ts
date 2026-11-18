import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { handoffMetrics } from '../scripts/handoff-metrics.js';

test('handoff metrics expose only aggregate timings of the matching admission, transport and Hub records', t => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-metrics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'transport'));
  const admission = join(root, 'handoff.db');
  const transport = join(root, 'transport', 'bridge.db');
  const hub = join(root, 'hub.db');
  function seed(file: string, sql: string) {
    const db = new DatabaseSync(file);
    try { db.exec(sql); }
    finally { db.close(); }
  }
  seed(admission, `
    CREATE TABLE requests (id TEXT PRIMARY KEY, execution TEXT, input TEXT);
    CREATE TABLE executions (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE guards (execution TEXT);
    CREATE TABLE assignments (run INTEGER PRIMARY KEY, request TEXT);
    CREATE TABLE submissions (request TEXT, event INTEGER);
    CREATE TABLE verifications (execution TEXT);
    CREATE TABLE repair_goals (execution TEXT);
    INSERT INTO requests VALUES ('r1','e1','sensitive input'),('r2','e2',''),('r3','e3',''),('r4','e4',''),
      ('r5','e5',''),('r6','e6',''),('r7','e7','');
    INSERT INTO executions VALUES ('e1','completed'),('e3','unknown');
    INSERT INTO guards VALUES ('e3');
    INSERT INTO assignments VALUES (1,'r1'),(2,'r2'),(3,'r3'),(4,'r3'),(5,'r5'),(6,'r6'),(7,'r7');
    INSERT INTO submissions VALUES ('r1',11),('r2',22),('r3',33),('r5',55),('r6',66),('r7',77);
    INSERT INTO verifications VALUES ('e2');
    INSERT INTO repair_goals VALUES ('e3');
  `);
  seed(transport, `
    CREATE TABLE tasks (id TEXT PRIMARY KEY, created_at INTEGER, finished_at INTEGER, feedback_at INTEGER, delivered_at INTEGER);
    INSERT INTO tasks VALUES ('e1',100,900,120,1000),('e2',200,NULL,190,NULL),('different-deployment',0,0,0,0);
  `);
  seed(hub, `
    CREATE TABLE runs (id INTEGER PRIMARY KEY, created_at TEXT, claimed_at TEXT, finished_at TEXT, attempts INTEGER, usage TEXT);
    CREATE TABLE run_events (run_id INTEGER, event_id INTEGER);
    CREATE TABLE events (id INTEGER PRIMARY KEY, key TEXT, subject TEXT);
    INSERT INTO runs VALUES
      (1,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.025Z','2026-11-18T00:00:02.025Z',1,NULL),
      (2,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.001Z','2026-11-18T00:00:00.002Z',2,'{"private":"usage"}'),
      (3,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.001Z','2026-11-18T00:00:00.002Z',1,NULL),
      (5,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.001Z','2026-11-18T00:00:00.002Z',1,NULL),
      (6,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.001Z','2026-11-18T00:00:00.002Z',1,NULL),
      (7,'2026-11-18T00:00:00.000Z','2026-11-18T00:00:00.001Z','2026-11-18T00:00:00.002Z',1,NULL);
    INSERT INTO run_events VALUES (1,11),(2,22),(3,33),(5,56),(6,66),(8,77);
    INSERT INTO events VALUES (11,'r1','r1'),(22,'another-installation','r2'),(33,'r3','r3'),
      (56,'r5','r5'),(66,'r6','different-subject'),(77,'r7','r7');
  `);
  const baseline = [admission, transport, hub].map(file => readFileSync(file));
  const report = handoffMetrics(root, hub);
  assert.equal(report.requests, 7);
  assert.deepEqual(report.taskTypes, { ordinary: 5, verify: 1, repair: 1 });
  assert.deepEqual(report.nativeState, { noExecutionRecord: 5, active: 0, completed: 1, interrupted: 0, unknown: 1, unknownWithGuard: 1 });
  assert.deepEqual(report.coverage, { transportProjected: 2, matchedHubRuns: 1, hubRunsWithRepeatedClaims: 0, matchedHubRunsWithReportedUsage: 0 });
  assert.deepEqual(report.hubRunCreatedToRecordedClaim, { samples: 1, p50Ms: 25, p95Ms: 25 });
  assert.deepEqual(report.hubRecordedClaimToRunFinished, { samples: 1, p50Ms: 2000, p95Ms: 2000 });
  assert.deepEqual(report.transportProjectionToFeedback, { samples: 1, p50Ms: 20, p95Ms: 20 });
  assert.deepEqual(report.transportFirstTerminalProjectionToFirstResult, { samples: 1, p50Ms: 100, p95Ms: 100 });
  assert.doesNotMatch(JSON.stringify(report), /sensitive input|another-installation|private/);
  assert.deepEqual([admission, transport, hub].map(file => readFileSync(file)), baseline);
});
