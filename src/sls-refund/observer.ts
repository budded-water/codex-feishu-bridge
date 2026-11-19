import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openPrivateDatabase } from '../private-database.js';

export const channels = ['wechat_pay', 'alipay'] as const;
export type Channel = typeof channels[number];
export const alertStatuses = ['inactive', 'firing', 'error', 'paused', 'pending'] as const;
export type Evaluation = { id: string; at: number; status: typeof alertStatuses[number] };
export type Binding = { mode: 'replay' | 'live'; region: string; project: string; rule: string; start: number };
export type BacklogSample = { channel: Channel; at: number; pending: number; queryable: number; missing: number; oldestSeconds: number };
export type RecoverySample = { at: number; outcome: 'completed' | 'degraded' | 'failed' | 'timeout' | 'overlap_skipped'; queryErrors: number; deferred: number };
export type Evidence = { backlog: BacklogSample[]; recovery?: RecoverySample; backlogRun?: string; recoveryRun?: string;
  unavailable?: 'source-query-failed' | 'invalid-or-incomplete-source' };
type Assessment = {
  state: 'healthy' | 'issue' | 'unavailable';
  reason?: Evidence['unavailable'] | 'insufficient-fresh-evidence';
  signals: ('aged-backlog' | 'missing-channel-identity' | 'recovery-job-unhealthy')[];
};
type Incident = { id: string; opened: number; last_firing: number; detected: number; state: 'open' | 'resolved' | 'needs-attention' };
type Slot = 0 | 1 | 2;
export type DueSample = { incident: string; slot: Slot; firing: number; dueAt: number; evidenceThrough: number };
const followups = [0, 5 * 60, 15 * 60] as const;
const maxAge = 5 * 60;
const backlogThreshold = 15 * 60;
export const isSecond = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function fresh(at: number, now: number, lower: number, through = now + 1) {
  return isSecond(at) && at >= lower && at <= now && at < through && now - at <= maxAge;
}

function assess(evidence: Evidence, now: number, lower: number, through: number): Assessment {
  const { recovery, backlog } = evidence;
  const allChannels = backlog.length === channels.length && channels.every(channel => backlog.some(sample => sample.channel === channel));
  if (evidence.unavailable || !recovery || !evidence.backlogRun || !evidence.recoveryRun || !allChannels ||
    !fresh(recovery.at, now, lower, through) ||
    backlog.some(sample => !fresh(sample.at, now, lower, through) ||
      ![sample.pending, sample.queryable, sample.missing, sample.oldestSeconds].every(isSecond) ||
      sample.queryable > sample.pending - sample.missing || (!sample.pending && sample.oldestSeconds !== 0)) ||
    ![recovery.queryErrors, recovery.deferred].every(isSecond)) {
    return { state: 'unavailable', signals: [], reason: evidence.unavailable ?? 'insufficient-fresh-evidence' };
  }

  const signals: Assessment['signals'] = [];
  if (backlog.some(sample => sample.oldestSeconds > backlogThreshold)) signals.push('aged-backlog');
  if (backlog.some(sample => sample.missing > 0)) signals.push('missing-channel-identity');
  if (recovery.outcome !== 'completed' || recovery.queryErrors || recovery.deferred) signals.push('recovery-job-unhealthy');
  return { state: signals.length ? 'issue' : 'healthy', signals };
}

export class RefundObserver {
  private db: DatabaseSync;

  constructor(directory: string, readonly binding: Binding) {
    this.db = openPrivateDatabase(directory, 'refund-observer.db');
    try {
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS source (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, through INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS evaluations (id TEXT PRIMARY KEY, at INTEGER NOT NULL, status TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY, opened INTEGER NOT NULL, last_firing INTEGER NOT NULL,
            detected INTEGER NOT NULL, state TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS active_incident ON incidents((1)) WHERE state<>'resolved';
          CREATE TABLE IF NOT EXISTS observations (
            incident TEXT REFERENCES incidents(id), slot INTEGER, observed INTEGER NOT NULL,
            firing INTEGER NOT NULL, body TEXT NOT NULL, assessment TEXT NOT NULL,
            evidence_through INTEGER, PRIMARY KEY(incident,slot)
          );
        `);
        const columns = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
        if (!columns.some(column => column.name === 'evidence_through')) {
          this.db.exec('ALTER TABLE observations ADD COLUMN evidence_through INTEGER');
        }
        const identity = JSON.stringify([binding.mode, binding.region, binding.project, binding.rule, binding.start]);
        this.db.prepare('INSERT OR IGNORE INTO source VALUES (1,?,?)').run(identity, binding.start);
        const found = this.db.prepare('SELECT binding FROM source WHERE id=1').get() as { binding: string };
        if (found.binding !== identity) throw new Error('Observer state belongs to a different source or starting point');
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  through(): number {
    return (this.db.prepare('SELECT through FROM source WHERE id=1').get() as { through: number }).through;
  }

  acceptWindow(from: number, to: number, evaluations: Evaluation[], now: number): void {
    if (![from, to, now].every(isSecond) || from < this.binding.start || from >= to || to > now ||
      evaluations.some(event => !isSecond(event.at) || event.at < from || event.at >= to ||
        !alertStatuses.includes(event.status) || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(event.id))) {
      throw new Error('Invalid scoped evaluation window');
    }
    this.transaction(() => {
      const previous = this.through();
      if (from > previous) throw new Error('The evaluation window would skip unread history');

      const latest = this.db.prepare("SELECT MAX(at) AS at FROM evaluations WHERE status='firing'").get() as { at: number | null };
      let newest = latest.at ?? -1;
      for (const event of [...evaluations].sort((a, b) => a.at - b.at || Number(b.status === 'firing') - Number(a.status === 'firing'))) {
        const recorded = this.db.prepare('SELECT at,status FROM evaluations WHERE id=?').get(event.id) as Pick<Evaluation, 'at' | 'status'> | undefined;
        if (recorded) {
          if (recorded.at !== event.at || recorded.status !== event.status) throw new Error('An evaluation ID changed its meaning');
          continue;
        }
        this.db.prepare('INSERT INTO evaluations VALUES (?,?,?)').run(event.id, event.at, event.status);
        if (event.at > newest && event.status === 'firing') {
          const active = this.active();
          if (active) this.db.prepare('UPDATE incidents SET last_firing=? WHERE id=?').run(event.at, active.id);
          else this.retainFiring(event.at, now);
        }
        if (event.status === 'firing') newest = Math.max(newest, event.at);
      }

      if (to > previous) this.db.prepare('UPDATE source SET through=? WHERE id=1').run(to);
    });
  }

  private retainFiring(at: number, now: number): void {
    const closed = this.db.prepare(`SELECT i.id,COALESCE(final.evidence_through,final.observed+1) AS through,first.body
      FROM incidents i JOIN observations final ON final.incident=i.id AND final.slot=2
      JOIN observations first ON first.incident=i.id AND first.slot=1
      WHERE i.state='resolved' ORDER BY i.rowid DESC LIMIT 1`).get() as
      { id: string; through: number; body: string } | undefined;
    if (closed && at < closed.through) {
      const earlier = JSON.parse(closed.body) as Evidence;
      const firstHealthy = Math.min(earlier.recovery!.at, ...earlier.backlog.map(sample => sample.at));
      if (at >= firstHealthy) {
        // Late data can invalidate a confirmed recovery without creating a
        // second incident or granting another automatic observation budget.
        this.db.prepare("UPDATE incidents SET last_firing=?,state='needs-attention' WHERE id=?").run(at, closed.id);
      }
      return;
    }
    this.db.prepare("INSERT INTO incidents VALUES (?,?,?,?,'open')").run(randomUUID(), at, at, now);
  }

  private active(): Incident | undefined {
    return this.db.prepare("SELECT * FROM incidents WHERE state<>'resolved'").get() as Incident | undefined;
  }

  nextSample(now: number): DueSample | undefined {
    const incident = this.active();
    if (!incident || incident.state !== 'open' || now < incident.detected) return;
    const slot: Slot = now >= incident.detected + followups[2] ? 2 : now >= incident.detected + followups[1] ? 1 : 0;
    const saved = this.db.prepare('SELECT MAX(slot) AS slot FROM observations WHERE incident=?').get(incident.id) as { slot: number | null };
    if (saved.slot !== null && saved.slot >= slot) return;
    // Use an already accepted history horizon for the final slot. The newest
    // inactive evaluation must also be at or after any evidence used to close.
    const latest = this.latestEvaluation();
    const covered = Math.min(now, this.through());
    const evidenceThrough = slot === 2
      ? Math.min(covered, latest?.status === 'inactive' ? latest.at + 1 : covered)
      : now;
    return { incident: incident.id, slot, firing: incident.last_firing, dueAt: incident.detected + followups[slot], evidenceThrough };
  }

  observe(expected: DueSample, now: number, evidence: Evidence): boolean {
    return this.transaction(() => {
      const sample = this.nextSample(now);
      if (!sample || sample.incident !== expected.incident || sample.slot !== expected.slot || sample.firing !== expected.firing ||
        sample.evidenceThrough !== expected.evidenceThrough) return false;
      const result = assess(evidence, now, sample.firing + 1, sample.evidenceThrough);
      this.db.prepare('INSERT INTO observations VALUES (?,?,?,?,?,?,?)')
        .run(sample.incident, sample.slot, now, sample.firing, JSON.stringify(evidence), JSON.stringify(result), sample.evidenceThrough);
      if (sample.slot === 2) {
        const latest = this.latestEvaluation();
        const earlier = this.db.prepare('SELECT firing,body,assessment FROM observations WHERE incident=? AND slot=1')
          .get(sample.incident) as { firing: number; body: string; assessment: string } | undefined;
        const resolved = latest?.status === 'inactive' && fresh(latest.at, now, sample.firing + 1) &&
          earlier && earlier.firing === sample.firing && result.state === 'healthy' &&
          (JSON.parse(earlier.assessment) as Assessment).state === 'healthy' &&
          this.samplesAdvance(JSON.parse(earlier.body) as Evidence, evidence);
        this.db.prepare('UPDATE incidents SET state=? WHERE id=?').run(resolved ? 'resolved' : 'needs-attention', sample.incident);
      }
      return true;
    });
  }

  private samplesAdvance(previous: Evidence, current: Evidence): boolean {
    return Boolean(previous.backlogRun && previous.recoveryRun && current.backlogRun !== previous.backlogRun &&
      current.recoveryRun !== previous.recoveryRun) && current.recovery!.at > previous.recovery!.at &&
      current.backlog.every(sample => sample.at > previous.backlog.find(other => other.channel === sample.channel)!.at);
  }

  private latestEvaluation(): Pick<Evaluation, 'at' | 'status'> | undefined {
    return this.db.prepare(`SELECT at,status FROM evaluations ORDER BY at DESC,
      (status='inactive') ASC LIMIT 1`).get() as Pick<Evaluation, 'at' | 'status'> | undefined;
  }

  report() {
    const latest = this.db.prepare('SELECT * FROM incidents ORDER BY rowid DESC LIMIT 1').get() as Incident | undefined;
    const observations = latest ? (this.db.prepare('SELECT slot,observed,body,assessment,evidence_through FROM observations WHERE incident=? ORDER BY slot')
      .all(latest.id) as { slot: number; observed: number; body: string; assessment: string; evidence_through: number | null }[])
      .map(({ slot, observed, body, assessment, evidence_through }) => {
        const { backlog, recovery } = JSON.parse(body) as Evidence;
        return { slot, observed, evidenceThrough: evidence_through, ...JSON.parse(assessment) as Assessment, evidence: { backlog, recovery } };
      }) : [];
    const evaluations = (this.db.prepare('SELECT COUNT(*) AS total FROM evaluations').get() as { total: number }).total;
    return {
      mode: this.binding.mode, through: this.through(), evaluations, latestEvaluation: this.latestEvaluation() ?? null,
      incident: latest ? { id: latest.id, state: latest.state, opened: latest.opened, lastFiring: latest.last_firing,
        followups: followups.slice(1).map(offset => latest.detected + offset), observations } : null,
    };
  }

  close(): void { this.db.close(); }
}
