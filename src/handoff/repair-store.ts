import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Permit, VerificationSelection } from './store.js';
import { fingerprint, profileDigest, type VerificationProfile } from './verification-profile.js';
import type { VerificationObservation } from './verification-runner.js';

// Verifier grace (95s), native close and evidence publication must fit outside the work budget.
export const REPAIR_CLEANUP_MS = 130_000;
export type RepairOutcome = 'pass' | 'fail' | 'ineligible' | 'incomplete' | 'stopped' | 'unknown';
export type AttemptOutcome = { task: string | null; thread: string | null; turn: string | null; status: string; generation: string };
export type AttemptCheckpoint = { outcome: AttemptOutcome; databaseHash: string | null; checkpoint: string };
export interface RepairAttempt {
  id: string; ordinal: number; phase: 'native' | 'native-settled' | 'verifying' | 'observed';
  startedAt: number; nativeFinishedAt: number | null; verificationStartedAt: number | null; observedAt: number | null;
  native: AttemptCheckpoint | null; observation: VerificationObservation | null;
}
export interface RepairGoal {
  version: 1; execution: string; profile: string; digest: string; definition: VerificationProfile;
  deadline: number; cleanupDeadline: number; stop: boolean; reason: string;
  status: RepairOutcome | null; attempts: RepairAttempt[];
}

export class RepairStore {
  constructor(private db: DatabaseSync, private validate: (permit: Permit) => void) {
    db.exec(`CREATE TABLE IF NOT EXISTS repair_goals (
      execution TEXT PRIMARY KEY REFERENCES requests(execution), profile TEXT NOT NULL, digest TEXT NOT NULL,
      definition TEXT NOT NULL, deadline INTEGER NOT NULL, cleanup_deadline INTEGER NOT NULL,
      stopped INTEGER NOT NULL DEFAULT 0, status TEXT, reason TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS repair_attempts (
      id TEXT PRIMARY KEY, execution TEXT NOT NULL REFERENCES repair_goals(execution), ordinal INTEGER NOT NULL CHECK(ordinal IN (1,2)),
      phase TEXT NOT NULL, native TEXT, observation TEXT, live_thread TEXT, live_turn TEXT, live_generation TEXT,
      started_at INTEGER NOT NULL, native_finished_at INTEGER, verification_started_at INTEGER, observed_at INTEGER, UNIQUE(execution,ordinal)
    );`);
  }

  // Called only inside AdmissionStore.accept's transaction, after immutable request insertion.
  admit(execution: string, selection: VerificationSelection, blocked: boolean): void {
    if (!selection.definition.repair) throw new Error('Repair policy is not enabled');
    const deadline = Date.now() + selection.definition.repair.timeoutMs;
    this.db.prepare('INSERT INTO repair_goals(execution,profile,digest,definition,deadline,cleanup_deadline,status,reason) VALUES (?,?,?,?,?,?,?,?)')
      .run(execution, selection.profile, profileDigest(selection.definition), JSON.stringify(selection.definition), deadline, deadline + REPAIR_CLEANUP_MS,
        blocked ? 'incomplete' : null, blocked ? 'Prior execution is unconfirmed' : '');
  }

  get(execution: string): RepairGoal | undefined {
    const row = this.db.prepare('SELECT * FROM repair_goals WHERE execution=?').get(execution) as
      { profile: string; digest: string; definition: string; deadline: number; cleanup_deadline: number; stopped: number; status: RepairOutcome | null; reason: string } | undefined;
    if (!row) return;
    const attempts = (this.db.prepare(`SELECT id,ordinal,phase,native,observation,started_at AS startedAt,native_finished_at AS nativeFinishedAt,
      verification_started_at AS verificationStartedAt,observed_at AS observedAt FROM repair_attempts WHERE execution=? ORDER BY ordinal`).all(execution) as
      (Omit<RepairAttempt, 'native' | 'observation'> & { native: string | null; observation: string | null })[])
      .map(a => ({ ...a, native: a.native ? JSON.parse(a.native) as AttemptCheckpoint : null,
        observation: a.observation ? JSON.parse(a.observation) as VerificationObservation : null }));
    return { version: 1, execution, profile: row.profile, digest: row.digest, definition: JSON.parse(row.definition),
      deadline: row.deadline, cleanupDeadline: row.cleanup_deadline, stop: Boolean(row.stopped), status: row.status, reason: row.reason, attempts };
  }

  binding(execution: string): string { return fingerprint(JSON.stringify(this.get(execution))); }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  stop(execution: string, reason = 'Owner requested stop'): void {
    this.db.prepare('UPDATE repair_goals SET stopped=1,reason=? WHERE execution=? AND status IS NULL').run(reason, execution);
  }

  launch(permit: Permit, kind: 'native' | 'verifier'): RepairAttempt {
    return this.transaction(() => {
      this.validate(permit);
      const goal = this.get(permit.execution)!;
      if (!goal || goal.status || goal.stop || Date.now() >= goal.deadline) throw new Error('Repair launch is no longer authorized');
      const previous = goal.attempts.at(-1);
      if (kind === 'native') {
        if (goal.attempts.length >= 2 || (previous && previous.phase !== 'observed')) throw new Error('Native repair credit unavailable');
        const attempt: RepairAttempt = { id: randomUUID(), ordinal: goal.attempts.length + 1, phase: 'native', native: null, observation: null,
          startedAt: Date.now(), nativeFinishedAt: null, verificationStartedAt: null, observedAt: null };
        this.db.prepare('INSERT INTO repair_attempts(id,execution,ordinal,phase,started_at) VALUES (?,?,?,?,?)').run(attempt.id, permit.execution, attempt.ordinal, attempt.phase, attempt.startedAt);
        return attempt;
      }
      if (!previous || previous.phase !== 'native-settled' || previous.native?.outcome.status !== 'completed') throw new Error('Verifier credit unavailable');
      const verificationStartedAt = Date.now();
      this.db.prepare("UPDATE repair_attempts SET phase='verifying',verification_started_at=? WHERE id=?").run(verificationStartedAt, previous.id);
      return { ...previous, phase: 'verifying', verificationStartedAt };
    });
  }

  native(permit: Permit, id: string, checkpoint: AttemptCheckpoint): void {
    this.validate(permit);
    if (!this.db.prepare("UPDATE repair_attempts SET native=?,native_finished_at=?,phase='native-settled' WHERE id=? AND execution=? AND phase='native'")
      .run(JSON.stringify(checkpoint), Date.now(), id, permit.execution).changes) throw new Error('Native attempt already sealed');
  }

  observed(permit: Permit, id: string, observation: VerificationObservation): void {
    this.validate(permit);
    if (!this.db.prepare("UPDATE repair_attempts SET observation=?,observed_at=?,phase='observed' WHERE id=? AND execution=? AND phase='verifying'")
      .run(JSON.stringify(observation), Date.now(), id, permit.execution).changes) throw new Error('Verification attempt already settled');
  }

  finish(permit: Permit, status: RepairOutcome, reason: string): void {
    this.validate(permit);
    if (!this.db.prepare('UPDATE repair_goals SET status=?,reason=? WHERE execution=? AND status IS NULL').run(status, reason, permit.execution).changes) {
      throw new Error('Repair goal already settled');
    }
  }
}
