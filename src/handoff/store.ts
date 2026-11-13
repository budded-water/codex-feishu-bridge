import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openPrivateDatabase } from '../private-database.js';
import { ownerKey, type IncomingMessage } from '../types.js';

export type RequestRecord = {
  id: string; execution: string; conversation: string; project: string;
  message: IncomingMessage; input: string; blocked: string | null;
};
export type Submission = { request: string; event: number | null; attempts: number };
export type Permit = { execution: string; token: string };
export type ExecutionRecord = {
  id: string; request: string; project: string; status: 'active' | 'unknown' | 'completed' | 'interrupted';
  evidence: string | null; problem: string | null;
};
export type Reservation = { kind: 'start'; permit: Permit; request: RequestRecord } |
  { kind: 'existing'; execution: ExecutionRecord } | { kind: 'blocked' | 'busy' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class AdmissionStore {
  private db: DatabaseSync;

  constructor(directory: string, binding: string) {
    this.db = openPrivateDatabase(directory, 'handoff.db');
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, owner TEXT NOT NULL, project TEXT NOT NULL, UNIQUE(owner,project)
        );
        CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY, execution TEXT NOT NULL UNIQUE, conversation TEXT NOT NULL REFERENCES conversations(id),
          project TEXT NOT NULL, origin TEXT NOT NULL UNIQUE, message TEXT NOT NULL, input TEXT NOT NULL, blocked TEXT
        );
        CREATE TABLE IF NOT EXISTS submissions (
          request TEXT PRIMARY KEY REFERENCES requests(id), event INTEGER, status TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0, next INTEGER NOT NULL DEFAULT 0, problem TEXT
        );
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY, request TEXT NOT NULL UNIQUE REFERENCES requests(id), project TEXT NOT NULL,
          status TEXT NOT NULL, token_hash TEXT NOT NULL, evidence TEXT, problem TEXT
        );
        CREATE TABLE IF NOT EXISTS guards (
          project TEXT PRIMARY KEY, execution TEXT NOT NULL UNIQUE REFERENCES executions(id)
        );
        CREATE TABLE IF NOT EXISTS assignments (
          run INTEGER PRIMARY KEY, request TEXT NOT NULL REFERENCES requests(id)
        );
        CREATE TABLE IF NOT EXISTS recoveries (
          origin TEXT PRIMARY KEY, execution TEXT NOT NULL REFERENCES executions(id), actor TEXT NOT NULL,
          evidence TEXT NOT NULL, created INTEGER NOT NULL
        );
      `);
      this.transaction(() => {
        this.db.prepare('INSERT OR IGNORE INTO binding VALUES (1,?)').run(binding);
        const saved = this.db.prepare('SELECT value FROM binding WHERE id=1').get() as { value: string };
        if (saved.value !== binding) throw new Error('Admission state belongs to another installation or registry');
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  request(id: string): RequestRecord | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as Omit<RequestRecord, 'message'> & { message: string } | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage };
  }

  accept(message: IncomingMessage, input: string, project: string): { duplicate: boolean; request: RequestRecord } {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM recoveries WHERE origin=?').get(origin)) throw new Error('Message identity already belongs to recovery');
      const previous = this.db.prepare('SELECT id FROM requests WHERE origin=?').get(origin) as { id: string } | undefined;
      if (previous) return { duplicate: true, request: this.request(previous.id)! };
      const owner = ownerKey(message);
      this.db.prepare('INSERT OR IGNORE INTO conversations VALUES (?,?,?)').run(randomUUID(), owner, project);
      const conversation = this.db.prepare('SELECT id FROM conversations WHERE owner=? AND project=?').get(owner, project) as { id: string };
      const uncertain = this.db.prepare("SELECT 1 FROM guards JOIN executions ON executions.id=guards.execution WHERE guards.project=? AND executions.status='unknown'").get(project);
      const request: RequestRecord = { id: randomUUID(), execution: randomUUID(), conversation: conversation.id, project,
        message, input, blocked: uncertain ? 'project_outcome_unknown' : null };
      this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?)').run(request.id, request.execution, request.conversation,
        project, origin, JSON.stringify(message), input, request.blocked);
      if (!request.blocked) this.db.prepare("INSERT INTO submissions(request,status) VALUES (?,'pending')").run(request.id);
      return { duplicate: false, request };
    });
  }

  pending(now = Date.now()): Submission[] {
    return this.db.prepare("SELECT request,event,attempts FROM submissions WHERE status='pending' AND next<=? ORDER BY rowid LIMIT 20").all(now) as Submission[];
  }

  submission(id: string) {
    return this.db.prepare('SELECT status,event,attempts,problem FROM submissions WHERE request=?').get(id) as
      { status: 'pending' | 'scheduled' | 'blocked'; event: number | null; attempts: number; problem: string | null } | undefined;
  }

  rememberEvent(request: string, event: number): void {
    const current = this.submission(request);
    if (!current || (current.event !== null && current.event !== event)) throw new Error('Source event identity changed');
    this.db.prepare('UPDATE submissions SET event=? WHERE request=?').run(event, request);
  }

  routed(request: string, valid: boolean): void {
    this.db.prepare("UPDATE submissions SET status=?, problem=? WHERE request=? AND status='pending'")
      .run(valid ? 'scheduled' : 'blocked', valid ? null : 'source_not_routed', request);
  }

  retry(request: string): void {
    this.db.prepare("UPDATE submissions SET next=?+MIN(60000,1000*(1 << MIN(attempts+1,6))), attempts=attempts+1, problem='source_unconfirmed' WHERE request=? AND status='pending'").run(Date.now(), request);
  }

  execution(id: string): ExecutionRecord | undefined {
    return this.db.prepare('SELECT id,request,project,status,evidence,problem FROM executions WHERE id=?').get(id) as ExecutionRecord | undefined;
  }

  unsettled(): ExecutionRecord[] {
    return this.db.prepare('SELECT executions.id,request,executions.project,status,evidence,problem FROM executions JOIN guards ON guards.execution=executions.id ORDER BY executions.rowid').all() as ExecutionRecord[];
  }

  reserve(requestId: string, run: number): Reservation {
    return this.transaction(() => {
      const request = this.request(requestId);
      if (!request) throw new Error('Unknown admitted request');
      const bound = this.db.prepare('SELECT request FROM assignments WHERE run=?').get(run) as { request: string } | undefined;
      if (bound && bound.request !== request.id) throw new Error('Run already belongs to another request');
      this.db.prepare('INSERT OR IGNORE INTO assignments VALUES (?,?)').run(run, request.id);
      const existing = this.execution(request.execution);
      if (existing) return { kind: 'existing', execution: existing };
      if (request.blocked || this.submission(request.id)?.status === 'blocked') return { kind: 'blocked' };
      const held = this.db.prepare('SELECT execution FROM guards WHERE project=?').get(request.project) as { execution: string } | undefined;
      if (held) {
        if (this.execution(held.execution)!.status !== 'unknown') return { kind: 'busy' };
        this.db.prepare("UPDATE requests SET blocked='project_outcome_unknown' WHERE id=?").run(request.id);
        return { kind: 'blocked' };
      }
      const permit = { execution: request.execution, token: randomUUID() };
      this.db.prepare("INSERT INTO executions(id,request,project,status,token_hash) VALUES (?,?,?,'active',?)")
        .run(permit.execution, request.id, request.project, digest(permit.token));
      this.db.prepare('INSERT INTO guards VALUES (?,?)').run(request.project, permit.execution);
      return { kind: 'start', permit, request };
    });
  }

  private validatePermit(permit: Permit): ExecutionRecord {
    const row = this.db.prepare('SELECT token_hash FROM executions WHERE id=?').get(permit.execution) as { token_hash: string } | undefined;
    if (!row || row.token_hash !== digest(permit.token)) throw new Error('Invalid execution owner');
    return this.execution(permit.execution)!;
  }

  uncertain(permit: Permit, problem: string): ExecutionRecord {
    this.validatePermit(permit);
    this.db.prepare("UPDATE executions SET status='unknown', problem=? WHERE id=? AND status='active'").run(problem, permit.execution);
    return this.execution(permit.execution)!;
  }

  terminal(permit: Permit, status: 'completed' | 'interrupted', evidence: string): ExecutionRecord {
    return this.transaction(() => {
      const execution = this.validatePermit(permit);
      if (execution.status === 'completed' || execution.status === 'interrupted') {
        if (execution.status !== status || execution.evidence !== evidence) throw new Error('Conflicting terminal evidence');
        return execution;
      }
      this.db.prepare('UPDATE executions SET status=?, evidence=? WHERE id=?').run(status, evidence, execution.id);
      this.db.prepare('DELETE FROM guards WHERE execution=?').run(execution.id);
      return this.execution(execution.id)!;
    });
  }

  reconcile(message: IncomingMessage, execution: string, evidence: string): void {
    this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM requests WHERE origin=?').get(origin)) throw new Error('Message identity already belongs to a task');
      const previous = this.db.prepare('SELECT execution,evidence FROM recoveries WHERE origin=?').get(origin) as { execution: string; evidence: string } | undefined;
      if (previous) {
        if (previous.execution !== execution || previous.evidence !== evidence) throw new Error('Recovery identity changed');
        return;
      }
      if (this.execution(execution)?.status !== 'unknown') throw new Error('Only uncertain execution can be reconciled');
      this.db.prepare('INSERT INTO recoveries VALUES (?,?,?,?,?)').run(origin, execution, ownerKey(message), evidence, Date.now());
      this.db.prepare('DELETE FROM guards WHERE execution=?').run(execution);
      // Keep the original uncertain outcome. A new request carries any remaining-work authorization.
    });
  }

  close(): void { this.db.close(); }
}
