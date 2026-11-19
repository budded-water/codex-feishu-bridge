import { createHash, randomUUID } from 'node:crypto';
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
          CREATE TABLE IF NOT EXISTS refund_notifications (
            id TEXT PRIMARY KEY, at INTEGER NOT NULL, scanned INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE IF NOT EXISTS refund_subscription (
            id INTEGER PRIMARY KEY CHECK(id=1), idle_floor INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS incidents (
            id TEXT PRIMARY KEY, opened INTEGER NOT NULL, last_firing INTEGER NOT NULL,
            detected INTEGER NOT NULL, state TEXT NOT NULL
          );
          CREATE UNIQUE INDEX IF NOT EXISTS observing_incident ON incidents((1)) WHERE state='open';
          DROP INDEX IF EXISTS active_incident;
          CREATE TABLE IF NOT EXISTS observations (
            incident TEXT REFERENCES incidents(id), slot INTEGER, observed INTEGER NOT NULL,
            firing INTEGER NOT NULL, body TEXT NOT NULL, assessment TEXT NOT NULL,
            evidence_through INTEGER, PRIMARY KEY(incident,slot)
          );
          CREATE TABLE IF NOT EXISTS incident_notices (
            incident TEXT REFERENCES incidents(id), state TEXT NOT NULL, card TEXT NOT NULL UNIQUE,
            projected INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(incident,state)
          );
          CREATE TABLE IF NOT EXISTS refund_closure_checks (
            incident TEXT PRIMARY KEY REFERENCES incidents(id), checkpoint INTEGER NOT NULL,
            through INTEGER NOT NULL, due INTEGER NOT NULL
          );
        `);
        const columns = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
        if (!columns.some(column => column.name === 'evidence_through')) {
          this.db.exec('ALTER TABLE observations ADD COLUMN evidence_through INTEGER');
        }
        const sourceColumns = this.db.prepare('PRAGMA table_info(source)').all() as { name: string }[];
        if (sourceColumns.some(column => column.name === 'idle_floor')) {
          // The deployed candidate used a column the previous observer cannot open.
          this.db.exec(`INSERT OR REPLACE INTO refund_subscription
            SELECT id,idle_floor FROM source WHERE idle_floor IS NOT NULL
            AND (SELECT state FROM incidents ORDER BY rowid DESC LIMIT 1) IS NOT 'needs-attention';
            ALTER TABLE source DROP COLUMN idle_floor;`);
        }
        const identity = JSON.stringify([binding.mode, binding.region, binding.project, binding.rule, binding.start]);
        this.db.prepare('INSERT OR IGNORE INTO source(id,binding,through) VALUES (1,?,?)').run(identity, binding.start);
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

  discoveryCursor(): number {
    return (this.db.prepare(`SELECT MAX(through,COALESCE((SELECT idle_floor FROM refund_subscription WHERE id=1),through))
      AS cursor FROM source WHERE id=1`)
      .get() as { cursor: number }).cursor;
  }

  retainNotification(notification: { id: string; at: number }, now: number): void {
    if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(notification.id) || !isSecond(notification.at) || !isSecond(now) ||
      notification.at < this.binding.start || notification.at > now) throw new Error('Invalid firing notification');
    const id = 'notification:' + createHash('sha256').update(notification.id).digest('hex');
    this.transaction(() => {
      const saved = this.db.prepare('SELECT at FROM refund_notifications WHERE id=?').get(id) as { at: number } | undefined;
      if (saved) {
        if (saved.at !== notification.at) throw new Error('A firing notification ID changed its meaning');
        return;
      }
      const latest = this.db.prepare("SELECT MAX(at) AS at FROM evaluations WHERE status='firing'").get() as { at: number | null };
      const prior = this.latestIncident();
      this.db.prepare('INSERT INTO refund_notifications(id,at) VALUES (?,?)').run(id, notification.at);
      this.db.prepare("INSERT INTO evaluations VALUES (?,?,'firing')").run(id, notification.at);
      this.reconcileEvaluation({ id, at: notification.at, status: 'firing' }, now, latest.at ?? -1);
      if ((!prior || prior.state === 'resolved') && this.latestIncident()?.id !== prior?.id) {
        // A prior handoff needs continuous history to distinguish a new firing.
        // The idle floor only changes where a read starts.
        const floor = Math.max(this.binding.start, now - 120);
        this.db.prepare(`INSERT INTO refund_subscription VALUES (1,?)
          ON CONFLICT(id) DO UPDATE SET idle_floor=MAX(idle_floor,excluded.idle_floor)`).run(floor);
      }
      this.splitAfterHandoff(now);
    });
  }

  notificationReadDue(before: number): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM refund_notifications WHERE scanned=0 AND at<? LIMIT 1').get(before));
  }

  finishNotificationReads(now: number): void {
    this.transaction(() => {
      const through = this.through();
      // Catch-up may cross many windows before the first sample is trustworthy.
      this.db.prepare(`UPDATE incidents SET detected=? WHERE state='open'
        AND NOT EXISTS (SELECT 1 FROM observations WHERE incident=incidents.id)
        AND EXISTS (SELECT 1 FROM refund_notifications WHERE scanned=0 AND at>=incidents.opened AND at<?)`)
        .run(now, through);
      this.db.prepare('UPDATE refund_notifications SET scanned=1 WHERE scanned=0 AND at<?').run(through);
    });
  }

  nextClosureCheck(now: number): { incident: string; checkpoint: number; through: number } | undefined {
    return this.db.prepare('SELECT incident,checkpoint,through FROM refund_closure_checks WHERE due<=? ORDER BY due,incident LIMIT 1')
      .get(now) as { incident: string; checkpoint: number; through: number } | undefined;
  }

  advanceClosureCheck(incident: string, checkpoint: number): void {
    this.transaction(() => {
      this.db.prepare('UPDATE refund_closure_checks SET checkpoint=? WHERE incident=?').run(checkpoint, incident);
      this.db.prepare('DELETE FROM refund_closure_checks WHERE incident=? AND checkpoint>=through').run(incident);
    });
  }

  acceptWindow(from: number, to: number, evaluations: Evaluation[], now: number): void {
    if (![from, to, now].every(isSecond) || from < this.binding.start || from >= to || to > now ||
      evaluations.some(event => !isSecond(event.at) || event.at < from || event.at >= to ||
        !alertStatuses.includes(event.status) || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(event.id))) {
      throw new Error('Invalid scoped evaluation window');
    }
    this.transaction(() => {
      const previous = this.through();
      if (from > this.discoveryCursor()) throw new Error('The evaluation window would skip unread history');

      const latest = this.db.prepare("SELECT MAX(at) AS at FROM evaluations WHERE status='firing'").get() as { at: number | null };
      let newest = latest.at ?? -1;
      for (const event of [...evaluations].sort((a, b) => a.at - b.at || Number(b.status === 'firing') - Number(a.status === 'firing'))) {
        const recorded = this.db.prepare('SELECT at,status FROM evaluations WHERE id=?').get(event.id) as Pick<Evaluation, 'at' | 'status'> | undefined;
        if (recorded) {
          if (recorded.at !== event.at || recorded.status !== event.status) throw new Error('An evaluation ID changed its meaning');
          continue;
        }
        this.db.prepare('INSERT INTO evaluations VALUES (?,?,?)').run(event.id, event.at, event.status);
        this.reconcileEvaluation(event, now, newest);
        if (event.status === 'firing') newest = Math.max(newest, event.at);
      }

      this.splitAfterHandoff(now);
      if (to > previous) {
        this.db.prepare('UPDATE source SET through=? WHERE id=1').run(to);
        this.db.prepare('DELETE FROM refund_subscription WHERE idle_floor<=?').run(to);
      }
    });
  }

  private reconcileEvaluation(event: Evaluation, now: number, latestFiring: number): void {
    const { at, status } = event;
    const firing = status === 'firing';
    if (status === 'inactive') return;
    const closed = this.db.prepare(`SELECT i.id,COALESCE(final.evidence_through,final.observed+1) AS through,first.body
      FROM incidents i JOIN observations final ON final.incident=i.id AND final.slot=2
      JOIN observations first ON first.incident=i.id AND first.slot=1
      WHERE i.state='resolved' AND i.opened<=? AND COALESCE(final.evidence_through,final.observed+1)>?
      ORDER BY i.rowid DESC LIMIT 1`).get(at, at) as
      { id: string; through: number; body: string } | undefined;
    if (closed) {
      const firstHealthy = this.earliestSample(JSON.parse(closed.body) as Evidence);
      if (firing ? at >= firstHealthy : at === closed.through - 1) {
        // Late data can invalidate a confirmed recovery without creating a
        // second incident or granting another automatic observation budget.
        this.db.prepare("UPDATE incidents SET last_firing=COALESCE(?,last_firing),state='needs-attention' WHERE id=?")
          .run(firing ? at : null, closed.id);
      }
      return;
    }
    if (!firing || at <= latestFiring) return;
    const latest = this.latestIncident();
    if (latest && latest.state !== 'resolved') {
      this.db.prepare('UPDATE incidents SET last_firing=? WHERE id=?').run(at, latest.id);
    } else {
      this.db.prepare("INSERT INTO incidents VALUES (?,?,?,?,'open')").run(randomUUID(), at, at, now);
    }
  }

  private splitAfterHandoff(now: number): void {
    const latest = this.latestIncident();
    if (latest?.state !== 'needs-attention') return;
    const final = this.db.prepare('SELECT firing, COALESCE(evidence_through,observed+1) AS horizon FROM observations WHERE incident=? AND slot=2')
      .get(latest.id) as { firing: number; horizon: number } | undefined;
    if (!final || latest.last_firing < final.horizon) return;

    // Window overlap may deliver the intervening quiet evaluation after the next firing.
    // Check the accepted history after all rows in the window have been recorded.
    const { at: quiet } = this.db.prepare(`SELECT MIN(q.at) AS at FROM evaluations AS q
      WHERE q.status='inactive' AND q.at>? AND q.at<?
        AND NOT EXISTS (SELECT 1 FROM evaluations AS other WHERE other.at=q.at AND other.status!='inactive')`)
      .get(final.firing, latest.last_firing) as { at: number | null };
    if (quiet === null) return;
    const { opened } = this.db.prepare("SELECT MIN(at) AS opened FROM evaluations WHERE status='firing' AND at>?")
      .get(quiet) as { opened: number };
    const { last } = this.db.prepare("SELECT MAX(at) AS last FROM evaluations WHERE status='firing' AND at<?")
      .get(quiet) as { last: number };
    this.db.prepare('UPDATE incidents SET last_firing=? WHERE id=?').run(last, latest.id);
    this.db.prepare("INSERT INTO incidents VALUES (?,?,?,?,'open')").run(randomUUID(), opened, latest.last_firing, now);
  }

  private latestIncident(): Incident | undefined {
    return this.db.prepare('SELECT * FROM incidents ORDER BY rowid DESC LIMIT 1').get() as Incident | undefined;
  }

  nextSample(now: number, requireFirstFiringCoverage = false): DueSample | undefined {
    const incident = this.latestIncident();
    if (!incident || incident.state !== 'open' || now < incident.detected) return;
    const slot: Slot = now >= incident.detected + followups[2] ? 2 : now >= incident.detected + followups[1] ? 1 : 0;
    const saved = this.db.prepare('SELECT MAX(slot) AS slot FROM observations WHERE incident=?').get(incident.id) as { slot: number | null };
    if (saved.slot !== null && saved.slot >= slot) return;
    if (requireFirstFiringCoverage && saved.slot === null && this.through() <= incident.last_firing) return;
    // Use an already accepted history horizon for the final slot. The newest
    // inactive evaluation must also be at or after any evidence used to close.
    const latest = this.latestEvaluation();
    const covered = Math.min(now, this.through());
    const evidenceThrough = slot === 2
      ? Math.min(covered, latest?.status === 'inactive' ? latest.at + 1 : covered)
      : now;
    return { incident: incident.id, slot, firing: incident.last_firing, dueAt: incident.detected + followups[slot], evidenceThrough };
  }

  observe(expected: DueSample, now: number, evidence: Evidence, closureCheckAt?: number): boolean {
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
        if (resolved && closureCheckAt !== undefined) {
          this.db.prepare('INSERT INTO refund_closure_checks VALUES (?,?,?,?)').run(sample.incident,
            this.earliestSample(JSON.parse(earlier.body) as Evidence), sample.evidenceThrough, closureCheckAt);
        }
      }
      return true;
    });
  }

  private samplesAdvance(previous: Evidence, current: Evidence): boolean {
    return Boolean(previous.backlogRun && previous.recoveryRun && current.backlogRun !== previous.backlogRun &&
      current.recoveryRun !== previous.recoveryRun) && current.recovery!.at > previous.recovery!.at &&
      current.backlog.every(sample => sample.at > previous.backlog.find(other => other.channel === sample.channel)!.at);
  }

  private earliestSample(evidence: Evidence): number {
    return Math.min(evidence.recovery!.at, ...evidence.backlog.map(sample => sample.at));
  }

  private latestEvaluation(): Pick<Evaluation, 'at' | 'status'> | undefined {
    return this.db.prepare(`SELECT at,status FROM evaluations ORDER BY at DESC,
      (status='inactive') ASC LIMIT 1`).get() as Pick<Evaluation, 'at' | 'status'> | undefined;
  }

  private observations(incident: string) {
    return (this.db.prepare('SELECT slot,observed,body,assessment,evidence_through FROM observations WHERE incident=? ORDER BY slot')
      .all(incident) as { slot: number; observed: number; body: string; assessment: string; evidence_through: number | null }[])
      .map(({ slot, observed, body, assessment, evidence_through }) => {
        const { backlog, recovery } = JSON.parse(body) as Evidence;
        return { slot, observed, evidenceThrough: evidence_through, ...JSON.parse(assessment) as Assessment, evidence: { backlog, recovery } };
      });
  }

  pendingNotices() {
    return this.transaction(() => {
      const incidents = this.db.prepare(`SELECT i.* FROM incidents i LEFT JOIN incident_notices n
        ON n.incident=i.id AND n.state=i.state WHERE COALESCE(n.projected,0)=0 ORDER BY i.rowid LIMIT 10`).all() as Incident[];
      return incidents.map(incident => {
        this.db.prepare('INSERT OR IGNORE INTO incident_notices(incident,state,card) VALUES (?,?,?)')
          .run(incident.id, incident.state, randomUUID());
        const { card } = this.db.prepare('SELECT card FROM incident_notices WHERE incident=? AND state=?')
          .get(incident.id, incident.state) as { card: string };
        return { card, incident: incident.id, state: incident.state, lastFiring: incident.last_firing,
          observation: this.observations(incident.id).at(-1) };
      });
    });
  }

  noticeProjected(card: string): void {
    this.db.prepare('UPDATE incident_notices SET projected=1 WHERE card=?').run(card);
  }

  report() {
    const latest = this.latestIncident();
    const observations = latest ? this.observations(latest.id) : [];
    const evaluations = (this.db.prepare('SELECT COUNT(*) AS total FROM evaluations').get() as { total: number }).total;
    const handoffs = this.db.prepare("SELECT id,opened,last_firing AS lastFiring FROM incidents WHERE state='needs-attention' ORDER BY rowid DESC LIMIT 10").all();
    return {
      mode: this.binding.mode, through: this.through(), evaluations, latestEvaluation: this.latestEvaluation() ?? null, handoffs,
      incident: latest ? { id: latest.id, state: latest.state, opened: latest.opened, lastFiring: latest.last_firing,
        followups: followups.slice(1).map(offset => latest.detected + offset), observations } : null,
    };
  }

  close(): void { this.db.close(); }
}
