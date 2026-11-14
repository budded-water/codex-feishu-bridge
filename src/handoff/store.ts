import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Maintenance } from '../maintenance.js';
import { openPrivateDatabase } from '../private-database.js';
import { ownerKey, type IncomingMessage, type NativeControlTarget, type ControlDisposition, type ChatContext } from '../types.js';

export type RequestRecord = {
  id: string; execution: string; conversation: string; project: string;
  message: IncomingMessage; input: string; blocked: string | null;
};
export type ControlRecord = { origin: string; execution: string; message: IncomingMessage; target: NativeControlTarget | null;
  status: 'received' | ControlDisposition; result: string | null };
export type RecoveryRecord = { origin: string; execution: string; actor: string; evidence: string; created: number };
export type WithdrawalRecord = { origin: string; request: string; actor: string; previous_blocked: string | null; previous_problem: string | null; created: number };
export const OWNER_WITHDRAWN = 'owner_withdrawn';
export type Submission = { request: string; event: number | null; attempts: number };
export type Permit = { execution: string; token: string };
export type ExecutionRecord = {
  id: string; request: string; project: string; status: 'active' | 'unknown' | 'completed' | 'interrupted';
  evidence: string | null; problem: string | null;
};
export type Reservation = { kind: 'start'; permit: Permit; request: RequestRecord } |
  { kind: 'existing'; execution: ExecutionRecord } | { kind: 'blocked' | 'busy' | 'withdrawn' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class AdmissionStore {
  private db: DatabaseSync;
  readonly maintenance: Maintenance;

  constructor(directory: string, binding: string) {
    this.db = openPrivateDatabase(directory, 'handoff.db');
    try {
      this.maintenance = new Maintenance(this.db);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS retained_receipts (tenant TEXT, message TEXT, reason TEXT NOT NULL, PRIMARY KEY(tenant,message));
        CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS channel_binding (kind TEXT PRIMARY KEY, external_id TEXT NOT NULL);
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
        CREATE TABLE IF NOT EXISTS controls (
          origin TEXT PRIMARY KEY, execution TEXT NOT NULL REFERENCES executions(id), message TEXT NOT NULL,
          target TEXT, status TEXT NOT NULL, result TEXT
        );
        CREATE TABLE IF NOT EXISTS recoveries (
          origin TEXT PRIMARY KEY, execution TEXT NOT NULL REFERENCES executions(id), actor TEXT NOT NULL,
          evidence TEXT NOT NULL, created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS withdrawals (
          origin TEXT PRIMARY KEY, request TEXT NOT NULL UNIQUE REFERENCES requests(id), actor TEXT NOT NULL,
          previous_blocked TEXT, previous_problem TEXT, created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS reference_context (
          origin TEXT PRIMARY KEY, execution TEXT NOT NULL REFERENCES requests(execution), body TEXT
        );
      `);
      this.transaction(() => {
        for (const [table, columns] of Object.entries({ conversations: ['thread', 'last_execution'], executions: ['native_thread', 'native_turn', 'native_generation'] })) {
          const present = this.db.prepare('PRAGMA table_info(' + table + ')').all() as { name: string }[];
          for (const name of columns) if (!present.some(column => column.name === name)) this.db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' TEXT');
        }
        this.db.prepare('INSERT OR IGNORE INTO binding VALUES (1,?)').run(binding);
        const saved = this.db.prepare('SELECT value FROM binding WHERE id=1').get() as { value: string };
        if (saved.value !== binding) {
          const legacy = JSON.parse(saved.value) as Record<string, unknown>;
          const bot = legacy.botOpenId;
          delete legacy.botOpenId;
          const migrated = JSON.stringify(Object.fromEntries(Object.entries(legacy).sort(([a], [b]) => a.localeCompare(b))));
          if (typeof bot !== 'string' || migrated !== binding) throw new Error('Admission state belongs to another installation or registry');
          this.db.prepare('INSERT OR IGNORE INTO channel_binding VALUES (?,?)').run('feishu', bot);
          const channel = this.db.prepare('SELECT external_id FROM channel_binding WHERE kind=?').get('feishu') as { external_id: string };
          if (channel.external_id !== bot) throw new Error('Channel identity changed');
          this.db.prepare('UPDATE binding SET value=? WHERE id=1').run(binding);
        }
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  bindChannel(kind: string, externalId: string): void {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO channel_binding VALUES (?,?)').run(kind, externalId);
      const saved = this.db.prepare('SELECT external_id FROM channel_binding WHERE kind=?').get(kind) as { external_id: string };
      if (saved.external_id !== externalId) throw new Error('Channel identity changed');
    });
  }

  request(id: string): RequestRecord | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as Omit<RequestRecord, 'message'> & { message: string } | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage };
  }

  accept(message: IncomingMessage, input: string, project: string): { duplicate: boolean; request: RequestRecord } | { paused: true } {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM recoveries WHERE origin=? UNION SELECT 1 FROM controls WHERE origin=? UNION SELECT 1 FROM withdrawals WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already belongs to a control');
      const previous = this.db.prepare('SELECT id FROM requests WHERE origin=?').get(origin) as { id: string } | undefined;
      if (previous) return { duplicate: true, request: this.request(previous.id)! };
      if (this.maintenance.paused) {
        this.db.prepare('INSERT OR IGNORE INTO retained_receipts VALUES (?,?,?)').run(message.tenant, message.id, 'maintenance');
        return { paused: true };
      }
      const owner = ownerKey(message);
      this.db.prepare('INSERT OR IGNORE INTO conversations(id,owner,project) VALUES (?,?,?)').run(randomUUID(), owner, project);
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

  retained(message: Pick<IncomingMessage, 'tenant' | 'id'>): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM retained_receipts WHERE tenant=? AND message=?').get(message.tenant, message.id));
  }

  importLegacy(seen: { tenant: string; id: string }[], conversation: { id: string; owner: string; project: string; thread: string | null } | null): void {
    this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM requests UNION SELECT 1 FROM controls').get()) throw new Error('Pilot already accepted traffic');
      for (const item of seen) this.db.prepare("INSERT OR IGNORE INTO retained_receipts VALUES (?,?,'legacy')").run(item.tenant, item.id);
      if (conversation) this.db.prepare('INSERT INTO conversations(id,owner,project,thread) VALUES (?,?,?,?)')
        .run(conversation.id, conversation.owner, conversation.project, conversation.thread);
      this.maintenance.quiesce();
    });
  }

  drainStatus(): Record<string, number | boolean> {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      paused: this.maintenance.paused,
      guards: count('SELECT COUNT(*) AS n FROM guards'),
      queued: count("SELECT COUNT(*) AS n FROM requests WHERE blocked IS NULL AND NOT EXISTS(SELECT 1 FROM executions WHERE executions.request=requests.id) AND NOT EXISTS(SELECT 1 FROM submissions WHERE submissions.request=requests.id AND status='blocked')"),
      publication: count("SELECT COUNT(*) AS n FROM submissions WHERE status='pending'"),
      controls: count("SELECT COUNT(*) AS n FROM controls WHERE status IN ('received','dispatching') AND EXISTS(SELECT 1 FROM guards WHERE guards.execution=controls.execution)"),
    };
  }

  requests(): RequestRecord[] {
    return (this.db.prepare('SELECT id FROM requests ORDER BY rowid').all() as { id: string }[]).map(row => this.request(row.id)!);
  }

  control(message: Pick<IncomingMessage, 'tenant' | 'id'>): ControlRecord | undefined {
    const row = this.db.prepare('SELECT * FROM controls WHERE origin=?').get(JSON.stringify([message.tenant, message.id])) as
      (Omit<ControlRecord, 'message' | 'target'> & { message: string; target: string | null }) | undefined;
    return row && { ...row, message: JSON.parse(row.message), target: row.target ? JSON.parse(row.target) : null };
  }

  acceptControl(execution: string, message: IncomingMessage): ControlRecord {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM requests WHERE origin=? UNION SELECT 1 FROM recoveries WHERE origin=? UNION SELECT 1 FROM withdrawals WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already has another purpose');
      const previous = this.control(message);
      if (previous) return previous;
      if (!this.db.prepare('SELECT 1 FROM guards WHERE execution=?').get(execution)) throw new Error('No current execution for control');
      this.db.prepare("INSERT INTO controls VALUES (?,?,?,NULL,'received',NULL)").run(origin, execution, JSON.stringify(message));
      return this.control(message)!;
    });
  }

  controls(): ControlRecord[] {
    return (this.db.prepare('SELECT message FROM controls ORDER BY rowid').all() as { message: string }[]).map(row => this.control(JSON.parse(row.message))!);
  }

  saveReference(execution: string, message: Pick<IncomingMessage, 'tenant' | 'id'>, context: ChatContext): void {
    const origin = JSON.stringify([message.tenant, message.id]);
    const admitted = this.db.prepare('SELECT execution FROM requests WHERE origin=? UNION SELECT execution FROM controls WHERE origin=?').all(origin, origin) as { execution: string }[];
    if (admitted.length !== 1 || admitted[0]!.execution !== execution) throw new Error('Reference does not belong to admitted input');
    const body = JSON.stringify(context);
    const previous = this.reference(execution, message);
    if (previous) return;
    this.db.prepare('INSERT INTO reference_context VALUES (?,?,?)').run(origin, execution, body);
  }

  reference(execution: string, message: Pick<IncomingMessage, 'tenant' | 'id'>): { context: ChatContext | null } | undefined {
    const row = this.db.prepare('SELECT body FROM reference_context WHERE origin=? AND execution=?')
      .get(JSON.stringify([message.tenant, message.id]), execution) as { body: string | null } | undefined;
    return row ? { context: row.body === null ? null : JSON.parse(row.body) as ChatContext } : undefined;
  }

  retireReferences(execution: string): void {
    this.db.prepare('UPDATE reference_context SET body=NULL WHERE execution=?').run(execution);
  }

  pendingControls(): ControlRecord[] {
    return (this.db.prepare(`SELECT message FROM controls WHERE status='received' OR (status IN ('dispatching','unknown') AND
      (EXISTS(SELECT 1 FROM guards WHERE guards.execution=controls.execution) OR
       EXISTS(SELECT 1 FROM executions WHERE executions.id=controls.execution AND executions.status IN ('completed','interrupted'))))
      ORDER BY status!='received',rowid`).all() as { message: string }[])
      .map(row => this.control(JSON.parse(row.message))!);
  }

  bindControl(message: IncomingMessage, target: NativeControlTarget): void {
    this.db.prepare("UPDATE controls SET target=? WHERE origin=? AND status='received' AND target IS NULL")
      .run(JSON.stringify(target), JSON.stringify([message.tenant, message.id]));
  }

  dispatchControl(message: IncomingMessage): boolean {
    return Boolean(this.db.prepare("UPDATE controls SET status='dispatching' WHERE origin=? AND status='received' AND target IS NOT NULL")
      .run(JSON.stringify([message.tenant, message.id])).changes);
  }

  controlResult(message: IncomingMessage, status: ControlDisposition, result?: string): void {
    this.db.prepare('UPDATE controls SET status=?,result=? WHERE origin=?')
      .run(status, result ?? null, JSON.stringify([message.tenant, message.id]));
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

  assignmentRuns(request: string): number[] {
    return (this.db.prepare('SELECT run FROM assignments WHERE request=? ORDER BY run').all(request) as { run: number }[]).map(row => row.run);
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
      if (request.blocked === OWNER_WITHDRAWN) return { kind: 'withdrawn' };
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

  ownedRequest(permit: Permit): RequestRecord {
    return this.request(this.validatePermit(permit).request)!;
  }

  startableRequest(permit: Permit): RequestRecord {
    const execution = this.validatePermit(permit);
    if (execution.status !== 'active' || !this.db.prepare('SELECT 1 FROM guards WHERE execution=? AND project=?').get(execution.id, execution.project)) {
      throw new Error('Execution no longer holds launch authority');
    }
    return this.request(execution.request)!;
  }

  conversationThread(id: string): string | null {
    const row = this.db.prepare('SELECT thread FROM conversations WHERE id=?').get(id) as { thread: string | null } | undefined;
    if (!row) throw new Error('Unknown conversation');
    return row.thread;
  }

  nativeSnapshot(permit: Permit, snapshot: { thread: string; turn: string | null; generation: string | null }): void {
    this.transaction(() => {
      const request = this.ownedRequest(permit);
      const prior = this.db.prepare('SELECT native_thread,native_turn,native_generation FROM executions WHERE id=?').get(permit.execution) as
        { native_thread: string | null; native_turn: string | null; native_generation: string | null };
      if ((prior.native_thread && prior.native_thread !== snapshot.thread) || (prior.native_turn && snapshot.turn && prior.native_turn !== snapshot.turn) ||
        (prior.native_generation && snapshot.generation && prior.native_generation !== snapshot.generation)) throw new Error('Native execution identity changed');
      this.db.prepare('UPDATE executions SET native_thread=?,native_turn=COALESCE(?,native_turn),native_generation=COALESCE(?,native_generation) WHERE id=?')
        .run(snapshot.thread, snapshot.turn, snapshot.generation, permit.execution);
      this.db.prepare(`UPDATE conversations SET thread=?,last_execution=? WHERE id=? AND
        (last_execution=? OR EXISTS(SELECT 1 FROM guards WHERE guards.execution=? AND guards.project=conversations.project))`)
        .run(snapshot.thread, permit.execution, request.conversation, permit.execution, permit.execution);
    });
  }

  ownerUnconfirmed(execution: string): void {
    this.db.prepare("UPDATE executions SET status='unknown',problem='owner_unreachable' WHERE id=? AND status='active' AND EXISTS(SELECT 1 FROM guards WHERE guards.execution=executions.id)").run(execution);
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

  recoveries(): RecoveryRecord[] {
    return this.db.prepare('SELECT * FROM recoveries ORDER BY created,origin').all() as RecoveryRecord[];
  }

  withdrawals(): WithdrawalRecord[] {
    return this.db.prepare('SELECT * FROM withdrawals ORDER BY created,origin').all() as WithdrawalRecord[];
  }

  withdraw(message: IncomingMessage, execution: string, project: string): { fresh: boolean; receipt: WithdrawalRecord } {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM requests WHERE origin=? UNION SELECT 1 FROM controls WHERE origin=? UNION SELECT 1 FROM recoveries WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already has another purpose');
      const selected = this.db.prepare('SELECT id FROM requests WHERE execution=?').get(execution) as { id: string } | undefined;
      const request = selected && this.request(selected.id);
      if (!request || request.project !== project || ownerKey(request.message) !== ownerKey(message) || request.message.chatType !== 'p2p') throw new Error('No owned private request');
      const previous = this.db.prepare('SELECT * FROM withdrawals WHERE origin=? OR request=?').all(origin, request.id) as WithdrawalRecord[];
      if (previous.length) {
        if (previous.length !== 1 || previous[0]!.request !== request.id || previous[0]!.actor !== ownerKey(message)) throw new Error('Withdrawal identity changed');
        return { fresh: false, receipt: previous[0]! };
      }
      if (this.retained(message) || this.execution(execution)) throw new Error('Request has already acquired execution authority or message is retained');
      const receipt: WithdrawalRecord = { origin, request: request.id, actor: ownerKey(message), previous_blocked: request.blocked,
        previous_problem: this.submission(request.id)?.problem ?? null, created: Date.now() };
      this.db.prepare('INSERT INTO withdrawals VALUES (?,?,?,?,?,?)').run(origin, request.id, receipt.actor, receipt.previous_blocked, receipt.previous_problem, receipt.created);
      this.db.prepare('UPDATE requests SET blocked=? WHERE id=?').run(OWNER_WITHDRAWN, request.id);
      this.db.prepare("UPDATE submissions SET status='blocked',problem=? WHERE request=?").run(OWNER_WITHDRAWN, request.id);
      this.db.prepare('INSERT INTO retained_receipts VALUES (?,?,?)').run(message.tenant, message.id, 'withdrawal');
      return { fresh: true, receipt };
    });
  }

  reconcile(message: IncomingMessage, execution: string, evidence: string): void {
    this.recordRecovery(JSON.stringify([message.tenant, message.id]), ownerKey(message), execution, evidence);
  }

  reconcileLocal(nonce: string, execution: string, evidence: string): void {
    this.recordRecovery(JSON.stringify(['local-maintenance', nonce]), 'local-runtime-operator', execution, evidence);
  }

  private recordRecovery(origin: string, actor: string, execution: string, evidence: string): void {
    this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM requests WHERE origin=? UNION SELECT 1 FROM controls WHERE origin=? UNION SELECT 1 FROM withdrawals WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already belongs to a task or control');
      const previous = this.db.prepare('SELECT execution,evidence FROM recoveries WHERE origin=?').get(origin) as { execution: string; evidence: string } | undefined;
      if (previous) {
        if (previous.execution !== execution || previous.evidence !== evidence) throw new Error('Recovery identity changed');
        return;
      }
      if (this.execution(execution)?.status !== 'unknown' || !this.db.prepare('SELECT 1 FROM guards WHERE execution=?').get(execution)) throw new Error('Only guarded uncertain execution can be reconciled');
      this.db.prepare('INSERT INTO recoveries VALUES (?,?,?,?,?)').run(origin, execution, actor, evidence, Date.now());
      this.db.prepare('DELETE FROM guards WHERE execution=?').run(execution);
      // Keep the original uncertain outcome. A new request carries any remaining-work authorization.
    });
  }

  close(): void { this.db.close(); }
}
