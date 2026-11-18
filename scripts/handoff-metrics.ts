import { join } from 'node:path';
import { openHandoffReader } from '../src/handoff/read-only.js';

function epochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)) return;
  const time = Date.parse(value);
  if (Number.isFinite(time)) return time;
}

function duration(rows: Record<string, unknown>[], start: string, end: string) {
  const samples = rows.flatMap(row => {
    const from = epochMs(row[start]), to = epochMs(row[end]);
    return from !== undefined && to !== undefined && to >= from ? [to - from] : [];
  }).sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50Ms: samples[Math.ceil(samples.length * 0.5) - 1] ?? null,
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1] ?? null,
  };
}

export function handoffMetrics(directory: string, hubPath: string) {
  const db = openHandoffReader(join(directory, 'handoff.db'), join(directory, 'transport', 'bridge.db'), hubPath);
  try {
    const rows = db.prepare(`WITH latest AS (
        SELECT id, execution FROM requests ORDER BY rowid DESC LIMIT 1000
      ), bound_runs AS (
        SELECT a.request, MIN(a.run) AS run
        FROM latest l JOIN assignments a ON a.request=l.id GROUP BY a.request HAVING COUNT(*)=1
      )
      SELECT e.status AS execution_status, t.id IS NOT NULL AS projected, g.execution IS NOT NULL AS held,
        t.created_at AS projected_at, t.feedback_at, t.finished_at AS terminal_projected_at, t.delivered_at,
        CASE WHEN rg.execution IS NOT NULL THEN 'repair' WHEN v.execution IS NOT NULL THEN 'verify' ELSE 'ordinary' END AS kind,
        h.id AS hub_run, h.created_at AS hub_created, h.claimed_at AS hub_claimed, h.finished_at AS hub_finished,
        h.attempts AS hub_attempts, h.usage IS NOT NULL AS usage_present
      FROM latest l
      LEFT JOIN executions e ON e.id=l.execution
      LEFT JOIN guards g ON g.execution=l.execution
      LEFT JOIN transport.tasks t ON t.id=l.execution
      LEFT JOIN verifications v ON v.execution=l.execution
      LEFT JOIN repair_goals rg ON rg.execution=l.execution
      LEFT JOIN submissions s ON s.request=l.id
      LEFT JOIN bound_runs b ON b.request=l.id
      LEFT JOIN hub.runs h ON h.id=b.run AND EXISTS(
        SELECT 1 FROM hub.run_events re JOIN hub.events ev ON ev.id=re.event_id
        WHERE re.run_id=b.run AND ev.id=s.event AND ev.key=l.id AND ev.subject=l.id)
    `).all();
    const count = (key: string, value: unknown) => rows.filter(row => row[key] === value).length;
    return {
      scope: 'Latest 1000 handoff admissions, across task types and any test fixtures',
      requests: rows.length,
      taskTypes: { ordinary: count('kind', 'ordinary'), verify: count('kind', 'verify'), repair: count('kind', 'repair') },
      nativeState: {
        noExecutionRecord: count('execution_status', null), active: count('execution_status', 'active'),
        completed: count('execution_status', 'completed'), interrupted: count('execution_status', 'interrupted'),
        unknown: count('execution_status', 'unknown'),
        unknownWithGuard: rows.filter(row => row.execution_status === 'unknown' && row.held === 1).length,
      },
      coverage: {
        transportProjected: count('projected', 1),
        matchedHubRuns: rows.length - count('hub_run', null),
        hubRunsWithRepeatedClaims: rows.filter(row => typeof row.hub_attempts === 'number' && row.hub_attempts > 1).length,
        matchedHubRunsWithReportedUsage: count('usage_present', 1),
      },
      hubRunCreatedToRecordedClaim: duration(rows, 'hub_created', 'hub_claimed'),
      hubRecordedClaimToRunFinished: duration(rows, 'hub_claimed', 'hub_finished'),
      transportProjectionToFeedback: duration(rows, 'projected_at', 'feedback_at'),
      transportProjectionToFirstResult: duration(rows, 'projected_at', 'delivered_at'),
      transportFirstTerminalProjectionToFirstResult: duration(rows, 'terminal_projected_at', 'delivered_at'),
    };
  } finally { db.close(); }
}
