import { parseMatterPresentation, redactMatterPresentation, type MatterClick, type MatterPresentation } from './matter-card.js';
import { readBrowserAccessBlocks, type BrowserAccessBlock } from './browser-access.js';
import { parseReviewPresentation, type ReviewPresentation, type ReviewClick } from './review-card.js';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Maintenance } from './maintenance.js';
import { openPrivateDatabase } from './private-database.js';
import { OWNER_WITHDRAWN, QUOTED_CONVERSATION_CHANGED, type RequestRecord, type ControlRecord } from './handoff/store.js';
import type { JournalProjection } from './handoff/journal.js';
import { splitReply } from './reply.js';
import { approvalCard, approvalText, parseApproval, cardMessage, approvalReplyTarget, APPROVAL_CARD_BYTES, type ApprovalPresentation, type ApprovalClick, type ApprovalView } from './approval.js';
import { parseTaskPresentation, redactTaskPresentation, type TaskPresentation, type TaskRefreshClick } from './task-card.js';
import { ownerKey, type IncomingMessage, type Session, type Task, type DeliveryOptions, type NativeControlTarget, type ControlDisposition } from './types.js';

export interface Delivery {
  id: string;
  chat: string;
  body: string;
  attempts: number;
  next: number;
  replyTo?: string;
  mentions?: string | null;
  taskId?: string;
  final?: number;
  approval?: ApprovalPresentation;
  updateMessage?: string;
  approvalView?: ApprovalView;
  taskView?: TaskPresentation;
  reviewCard?: ReviewPresentation;
  matterCard?: MatterPresentation;
}

export interface FeedbackRecord {
  task: string; message: string; chat: string; status: string;
  reaction: string | null; uncertain: number; fallback: number; attempts: number; next: number;
}

export class State {
  private db: DatabaseSync;
  private secrets: string[];
  readonly maintenance: Maintenance;

  constructor(directory: string, secrets: string[] = []) {
    this.secrets = secrets.filter(secret => secret.length > 4).sort((a, b) => b.length - a.length);
    this.db = openPrivateDatabase(directory, 'bridge.db');
    try {
      this.maintenance = new Maintenance(this.db);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS migration_reconciliations (task TEXT PRIMARY KEY, reference TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS seen (tenant TEXT, id TEXT, PRIMARY KEY (tenant, id));
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, owner TEXT, tenant TEXT, user TEXT, chat TEXT,
          project TEXT, directory TEXT, thread TEXT
        );
        CREATE TABLE IF NOT EXISTS selections (owner TEXT PRIMARY KEY, session TEXT REFERENCES sessions(id));
        CREATE TABLE IF NOT EXISTS migration_conversations (
          owner TEXT, directory TEXT, session TEXT NOT NULL REFERENCES sessions(id), PRIMARY KEY(owner,directory)
        );
        CREATE TABLE IF NOT EXISTS routing (owner TEXT PRIMARY KEY, thread TEXT, pending TEXT, source TEXT);
        CREATE TABLE IF NOT EXISTS tasks (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, session TEXT REFERENCES sessions(id),
          input TEXT, status TEXT, turn TEXT
        );
        CREATE TABLE IF NOT EXISTS outbox (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, chat TEXT, body TEXT,
          attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS feedback (
          task TEXT PRIMARY KEY REFERENCES tasks(id), message TEXT, reaction TEXT,
          uncertain INTEGER DEFAULT 0, fallback INTEGER DEFAULT 0,
          attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS projected_control_notices (origin TEXT NOT NULL, status TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(origin,status));
        CREATE TABLE IF NOT EXISTS approval_cards (id TEXT PRIMARY KEY, prompt TEXT NOT NULL UNIQUE, delivery TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL, message TEXT, rendered TEXT NOT NULL DEFAULT 'pending');
        CREATE TABLE IF NOT EXISTS task_views (id TEXT PRIMARY KEY, execution TEXT NOT NULL, delivery TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, message TEXT);
        CREATE TABLE IF NOT EXISTS projected_tasks (execution TEXT PRIMARY KEY, checkpoint TEXT, notified INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS projected_deliveries (id TEXT PRIMARY KEY, execution TEXT NOT NULL, live INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS relayed_controls (origin TEXT PRIMARY KEY, message TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_cards (id TEXT PRIMARY KEY, delivery TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, message TEXT);
        CREATE TABLE IF NOT EXISTS matter_cards (id TEXT PRIMARY KEY, delivery TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, message TEXT UNIQUE);
        CREATE TABLE IF NOT EXISTS review_notices (review TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS native_permission_reviews (id TEXT NOT NULL, generation TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(id,generation));
        CREATE TABLE IF NOT EXISTS browser_access_blocks(task TEXT NOT NULL, generation TEXT NOT NULL, item TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(task,generation,item));
        CREATE TABLE IF NOT EXISTS approvals (
          id TEXT PRIMARY KEY, task TEXT, method TEXT, status TEXT, created INTEGER
        );
      `);
      if (!(this.db.prepare('PRAGMA table_info(selections)').all() as { name: string }[]).some(column => column.name === 'revision')) this.db.exec('ALTER TABLE selections ADD COLUMN revision INTEGER DEFAULT 0');
      if (!(this.db.prepare('PRAGMA table_info(routing)').all() as { name: string }[]).some(column => column.name === 'source')) this.db.exec('ALTER TABLE routing ADD COLUMN source TEXT');
      const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
      if (!taskColumns.some(column => column.name === 'source')) this.db.exec('ALTER TABLE tasks ADD COLUMN source TEXT');
      if (!taskColumns.some(column => column.name === 'routed')) this.db.exec('ALTER TABLE tasks ADD COLUMN routed INTEGER DEFAULT 0');
      if (!taskColumns.some(column => column.name === 'diagnostic')) this.db.exec('ALTER TABLE tasks ADD COLUMN diagnostic TEXT');
      if (!taskColumns.some(column => column.name === 'routing_revision')) this.db.exec('ALTER TABLE tasks ADD COLUMN routing_revision INTEGER');
      if (!taskColumns.some(column => column.name === 'routing_origin')) this.db.exec('ALTER TABLE tasks ADD COLUMN routing_origin TEXT');
      const outboxColumns = this.db.prepare('PRAGMA table_info(outbox)').all() as { name: string }[];
      if (!outboxColumns.some(column => column.name === 'task')) this.db.exec('ALTER TABLE outbox ADD COLUMN task TEXT');
      for (const [name, definition] of Object.entries({ reply_to: 'TEXT', mentions: 'TEXT', response_task: 'TEXT', final: 'INTEGER DEFAULT 0', prompt_id: 'TEXT', approval: 'TEXT', update_message: 'TEXT', approval_view: 'TEXT', task_view: 'TEXT', review_card: 'TEXT', matter_card: 'TEXT', ordinary_answer: 'INTEGER NOT NULL DEFAULT 0' })) {
        if (!outboxColumns.some(column => column.name === name)) this.db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${definition}`);
      }
      this.db.exec('CREATE TABLE IF NOT EXISTS task_messages (message TEXT PRIMARY KEY, task TEXT REFERENCES tasks(id), chat TEXT)');
      if (!taskColumns.some(column => column.name === 'trigger_message')) this.db.exec('ALTER TABLE tasks ADD COLUMN trigger_message TEXT');
      const messageColumns = this.db.prepare('PRAGMA table_info(task_messages)').all() as { name: string }[];
      if (!messageColumns.some(column => column.name === 'chat')) this.db.exec('ALTER TABLE task_messages ADD COLUMN chat TEXT');
      if (!messageColumns.some(column => column.name === 'ordinary_answer')) this.db.exec('ALTER TABLE task_messages ADD COLUMN ordinary_answer INTEGER NOT NULL DEFAULT 0');
      for (const field of ['created_at','routing_at','routed_at','execution_at','finished_at','feedback_at','delivered_at']) {
        if (!taskColumns.some(column => column.name === field)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${field} INTEGER`);
      }
      const approvalColumns = this.db.prepare('PRAGMA table_info(approvals)').all() as { name: string }[];
      if (!approvalColumns.some(column => column.name === 'expires')) this.db.exec('ALTER TABLE approvals ADD COLUMN expires INTEGER');
      if (!approvalColumns.some(column => column.name === 'actor')) this.db.exec('ALTER TABLE approvals ADD COLUMN actor TEXT');
    } catch (error) { this.db.close(); throw error; }
  }

  drainStatus(): Record<string, number | boolean> {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      paused: this.maintenance.paused,
      queued: count("SELECT COUNT(*) AS n FROM tasks WHERE status='queued'"),
      running: count("SELECT COUNT(*) AS n FROM tasks WHERE status='running'"),
      unknown: count("SELECT COUNT(*) AS n FROM tasks WHERE status='unknown' AND NOT EXISTS(SELECT 1 FROM migration_reconciliations WHERE task=tasks.id)"),
      prompts: count("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'"),
      outbox: count('SELECT COUNT(*) AS n FROM outbox') + this.cardChanges(Date.now()).length,
      reactions: count('SELECT COUNT(*) AS n FROM feedback'),
      clarifications: count('SELECT COUNT(*) AS n FROM routing WHERE pending IS NOT NULL'),
    };
  }

  reconcileForMigration(task: string, reference: string): void {
    if (!reference.trim() || reference.length > 2000 || !this.db.prepare("SELECT 1 FROM tasks WHERE id=? AND status='unknown'").get(task)) throw new Error('Migration recovery needs an uncertain task and inspection reference');
    this.db.prepare('INSERT INTO migration_reconciliations VALUES (?,?) ON CONFLICT(task) DO UPDATE SET reference=excluded.reference').run(task, reference);
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  projectAssignedTask(request: RequestRecord, project: string, directory: string, status: string,
    receipt?: { matter: string; followup: boolean }): void {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO sessions(id,owner,tenant,user,chat,project,directory) VALUES (?,?,?,?,?,?,?)')
        .run(request.conversation, ownerKey(request.message), request.message.tenant, request.message.user, request.message.chat, project, directory);
      const fresh = Boolean(this.db.prepare('INSERT OR IGNORE INTO projected_tasks(execution) VALUES (?)').run(request.execution).changes);
      this.db.prepare('INSERT OR IGNORE INTO tasks(id,session,input,status,trigger_message,created_at,routed,source) VALUES (?,?,?,?,?,?,1,?)')
        .run(request.execution, request.conversation, request.input, status, request.message.id, Date.now(), JSON.stringify(request.message));
      this.taskStatus(request.execution, status);
      if (!['queued', 'running'].includes(status)) this.db.prepare("UPDATE approvals SET status='invalidated' WHERE task=? AND status='pending'").run(request.execution);
      if (fresh && request.blocked !== OWNER_WITHDRAWN && request.blocked !== QUOTED_CONVERSATION_CHANGED) {
        if (request.blocked) this.send(request.message.chat, '前一个任务的结果尚未确认，当前请求没有开始。请先核对实际结果。', { replyTo: request.message.id });
        else {
          this.db.prepare('INSERT INTO feedback(task,message,fallback) VALUES (?,?,?)')
            .run(request.execution, this.replyTarget(request.execution)!, receipt ? 1 : 0);
          if (receipt && !receipt.followup) this.send(request.message.chat, '已收到 · ' + receipt.matter, { replyTo: request.message.id });
        }
      }
    });
  }

  projectNativeMessages(request: RequestRecord, projection: JournalProjection & { sealed: boolean; checkpoint: string | null }, verification?: string,
    browserNotice?: string, ordinaryAnswer = false, admissionNotice?: string): void {
    this.transaction(() => {
      for (const prompt of projection.prompts) {
        this.db.prepare(`INSERT INTO approvals(id,task,method,status,created,expires,actor) VALUES (?,?,'native-projection',?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET status=excluded.status,expires=excluded.expires,actor=excluded.actor`)
          .run(request.execution + ':' + prompt.id, request.execution, prompt.status, Date.now(), prompt.expires, prompt.actor ?? null);
      }
      for (const row of projection.messages) {
        if (!this.db.prepare('INSERT OR IGNORE INTO projected_deliveries VALUES (?,?,?)').run(row.id, request.execution, projection.sealed ? 0 : 1).changes) {
          if (projection.sealed) this.db.prepare('UPDATE projected_deliveries SET live=0 WHERE id=?').run(row.id);
          continue;
        }
        this.db.prepare(`INSERT INTO outbox(id,chat,body,reply_to,mentions,response_task,final,prompt_id,task,ordinary_answer)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.chat, this.redact(row.body), row.reply_to, row.mentions,
          request.execution, row.final, row.prompt_id ? request.execution + ':' + row.prompt_id : null, row.transient ? request.execution : null,
          ordinaryAnswer && row.final && row.ordinary_answer && row.chat === request.message.chat ? 1 : 0);
        if (row.approval) {
          const p = this.redactApproval(row.approval);
          this.db.prepare('UPDATE outbox SET approval=? WHERE id=?').run(JSON.stringify(p), row.id);
          if (row.approval.remember && !p.remember) this.db.prepare('UPDATE outbox SET body=? WHERE id=?').run(approvalText(p), row.id);
          this.db.prepare('INSERT OR IGNORE INTO approval_cards(id,prompt,delivery,payload) VALUES (?,?,?,?)')
            .run(p.id, request.execution + ':' + p.prompt, row.id, JSON.stringify(p));
        }
      }
      if (projection.sealed) {
        if (verification && !this.verificationNoticeProjected(request.execution)) {
          this.db.prepare('INSERT INTO projected_control_notices VALUES (?,?,?)').run('verification/' + request.execution, 'observed', randomUUID());
          this.send(request.message.chat, verification, { taskId: request.execution, replyTo: request.message.id, final: true });
        }
        if (browserNotice && this.db.prepare('INSERT OR IGNORE INTO projected_control_notices VALUES (?,?,?)')
          .run('browser-access/' + request.execution, 'observed', randomUUID()).changes) {
          this.send(request.message.chat, browserNotice, { taskId: request.execution, replyTo: this.replyTarget(request.execution) });
        }
        if (admissionNotice) this.projectAdmissionNotice(request, admissionNotice);
        this.db.prepare('UPDATE projected_tasks SET checkpoint=? WHERE execution=?').run(projection.checkpoint, request.execution);
      }
    });
  }

  verificationNoticeProjected(execution: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM projected_control_notices WHERE origin=? AND status='observed'").get('verification/' + execution));
  }

  projectControlNotice(control: Pick<ControlRecord, 'origin' | 'message' | 'result'> & { status: string }): void {
    this.transaction(() => {
      if (!control.result || !['unknown', 'dispatching'].includes(control.status)) {
        this.db.prepare(`DELETE FROM outbox WHERE id IN (SELECT id FROM projected_control_notices WHERE origin=? AND status IN ('unknown','dispatching'))`).run(control.origin);
      }
      if (!control.result) return;
      if (this.db.prepare('SELECT 1 FROM projected_control_notices WHERE origin=? AND status=?').get(control.origin, control.status)) return;
      const id = randomUUID();
      this.db.prepare('INSERT INTO projected_control_notices VALUES (?,?,?)').run(control.origin, control.status, id);
      this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to) VALUES (?,?,?,?)').run(id, control.message.chat, this.redact(control.result), approvalReplyTarget(control.message) ?? null);
    });
  }

  recoveryNoticeProjected(origin: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM projected_control_notices WHERE origin=? AND status='recovered'").get(origin));
  }

  withdrawalNoticeProjected(origin: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM projected_control_notices WHERE origin=? AND status='withdrawn'").get(origin));
  }

  projectWithdrawalNotice(origin: string, message: Pick<IncomingMessage, 'chat' | 'id'>, execution: string): void {
    this.transaction(() => {
      if (this.withdrawalNoticeProjected(origin)) return;
      const id = randomUUID();
      this.db.prepare('INSERT INTO projected_control_notices VALUES (?,?,?)').run(origin, 'withdrawn', id);
      this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to) VALUES (?,?,?,?)').run(id, message.chat,
        `已撤回尚未开始的请求：${execution}。不会再启动；如仍需处理，请发送新消息。运行中的任务、未确认保护和维护暂停不会因此改变。`, message.id);
    });
  }

  projectRecoveryNotice(origin: string, message: Pick<IncomingMessage, 'chat' | 'id'>): void {
    this.transaction(() => {
      if (this.recoveryNoticeProjected(origin)) return;
      const id = randomUUID();
      this.db.prepare('INSERT INTO projected_control_notices VALUES (?,?,?)').run(origin, 'recovered', id);
      this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to) VALUES (?,?,?,?)').run(id, message.chat,
        '已记录你的进程与副作用检查依据，并解除该任务的执行保护。原任务仍为结果未确认，不会重跑；后续工作请发送新消息。系统维护暂停会保留。', message.id);
    });
  }

  projectedFinal(execution: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM projected_tasks WHERE execution=? AND checkpoint IS NOT NULL').get(execution));
  }

  projectAdmissionNotice(request: RequestRecord, body: string): void {
    const insert = () => {
      if (this.db.prepare('UPDATE projected_tasks SET notified=1 WHERE execution=? AND notified=0').run(request.execution).changes) {
        this.send(request.message.chat, body, { replyTo: request.message.id });
      }
    };
    if (this.db.isTransaction) insert(); else this.transaction(insert);
  }

  projectedDelivery(id: string): { execution: string; live: number } | undefined {
    return this.db.prepare('SELECT execution,live FROM projected_deliveries WHERE id=?').get(id) as { execution: string; live: number } | undefined;
  }

  beginRelayedControl(message: IncomingMessage, target: NativeControlTarget): { fresh: boolean; status: ControlDisposition } {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      const saved = this.db.prepare('SELECT message,target,status FROM relayed_controls WHERE origin=?').get(origin) as { message: string; target: string; status: ControlDisposition } | undefined;
      if (saved) {
        if (saved.message !== JSON.stringify(message) || saved.target !== JSON.stringify(target)) throw new Error('Control identity changed');
        return { fresh: false, status: saved.status };
      }
      this.db.prepare("INSERT INTO relayed_controls VALUES (?,?,?,'dispatching')").run(origin, JSON.stringify(message), JSON.stringify(target));
      return { fresh: true, status: 'dispatching' };
    });
  }

  relayedControlResult(message: IncomingMessage, status: ControlDisposition): void {
    this.db.prepare('UPDATE relayed_controls SET status=? WHERE origin=?').run(status, JSON.stringify([message.tenant, message.id]));
  }

  hasSeen(message: Pick<IncomingMessage, 'tenant' | 'id'>): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM seen WHERE tenant=? AND id=?').get(message.tenant, message.id));
  }

  remember(message: IncomingMessage): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO seen VALUES (?, ?)').run(message.tenant, message.id).changes) === 1;
  }
  seen(message: Pick<IncomingMessage, 'tenant' | 'id'>): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM seen WHERE tenant=? AND id=?').get(message.tenant, message.id));
  }

  selected(message: IncomingMessage): Session | undefined {
    return this.db.prepare('SELECT sessions.* FROM selections JOIN sessions ON sessions.id=selections.session WHERE selections.owner=?')
      .get(ownerKey(message)) as unknown as Session | undefined;
  }

  session(id: string): Session {
    const result = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as unknown as Session | undefined;
    if (!result) throw new Error('Unknown bridge session');
    return result;
  }

  select(message: IncomingMessage, project: string, directory: string, fresh = false, activate = true, manual = true): Session {
    const owner = ownerKey(message);
    let existing = fresh ? undefined : this.db.prepare(
      'SELECT sessions.* FROM migration_conversations JOIN sessions ON sessions.id=migration_conversations.session WHERE migration_conversations.owner=? AND migration_conversations.directory=?',
    ).get(owner, directory) as unknown as Session | undefined;
    existing ??= fresh ? undefined : this.db.prepare(
      'SELECT * FROM sessions WHERE owner=? AND project=? AND directory=? ORDER BY rowid DESC LIMIT 1',
    ).get(owner, project, directory) as unknown as Session | undefined;
    if (!existing) {
      existing = { id: randomUUID(), owner, tenant: message.tenant, user: message.user, chat: message.chat, project, directory, thread: null };
      this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        existing.id, owner, message.tenant, message.user, message.chat, project, directory, null,
      );
    }
    if (fresh) this.db.prepare('UPDATE migration_conversations SET session=? WHERE owner=? AND directory=?').run(existing.id, owner, directory);
    if (activate) this.db.prepare('INSERT INTO selections (owner,session,revision) VALUES (?, ?, ?) ON CONFLICT(owner) DO UPDATE SET session=excluded.session,revision=selections.revision+?').run(owner, existing.id, Number(manual), Number(manual));
    return existing;
  }

  setThread(session: string, thread: string): void {
    this.db.prepare('UPDATE sessions SET thread=? WHERE id=?').run(thread, session);
  }

  selectionRevision(owner: string): number {
    return (this.db.prepare('SELECT revision FROM selections WHERE owner=?').get(owner) as { revision: number } | undefined)?.revision ?? 0;
  }

  routing(owner: string): { thread: string; pending: string | null; source?: Task['source'] } | undefined {
    const row = this.db.prepare('SELECT thread,pending,source FROM routing WHERE owner=?').get(owner) as { thread: string; pending: string | null; source: string | null } | undefined;
    return row ? { thread: row.thread, pending: row.pending, ...(row.source ? { source: JSON.parse(row.source) as Task['source'] } : {}) } : undefined;
  }

  setRouting(owner: string, thread: string, pending: string | null, source?: Task['source']): void {
    this.db.prepare('INSERT INTO routing (owner,thread,pending,source) VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET thread=excluded.thread,pending=excluded.pending,source=excluded.source').run(owner, thread, pending, pending && source ? JSON.stringify(source) : null);
  }
  clearRouting(owner: string): void { this.db.prepare('DELETE FROM routing WHERE owner=?').run(owner); }
  clearPending(owner: string): void { this.db.prepare('UPDATE routing SET pending=NULL,source=NULL WHERE owner=?').run(owner); }

  routeTask(id: string, session: string, input: string, source?: Task['source']): void {
    this.db.prepare("UPDATE tasks SET session=?,input=?,source=?,routed=1,status='queued',turn=NULL WHERE id=? AND status='running'").run(session, input, source ? JSON.stringify(source) : null, id);
    this.db.prepare('UPDATE tasks SET routed_at=? WHERE id=?').run(Date.now(),id);
  }

  taskInput(id: string, input: string): void { this.db.prepare('UPDATE tasks SET input=? WHERE id=?').run(input, id); }
  taskDiagnostic(id: string): string | undefined {
    return (this.db.prepare('SELECT diagnostic FROM tasks WHERE id=?').get(id) as { diagnostic?: string } | undefined)?.diagnostic ?? undefined;
  }

  diagnostic(id: string, message: string): void { this.db.prepare('UPDATE tasks SET diagnostic=? WHERE id=?').run(message, id); }
  latestDiagnostic(session: string): string | undefined {
    return (this.db.prepare('SELECT diagnostic FROM tasks WHERE session=? ORDER BY sequence DESC LIMIT 1').get(session) as { diagnostic?: string } | undefined)?.diagnostic ?? undefined;
  }

  enqueue(session: string, input: string, source?: Task['source'], routingOrigin?: string, routingRevision?: number, routed = false): Task {
    const task: Task = { id: randomUUID(), session, input, status: 'queued', turn: null, source, routed };
    this.db.prepare('INSERT INTO tasks (id, session, input, status, source, routing_origin, routing_revision, routed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(task.id, session, input, task.status, source ? JSON.stringify(source) : null, routingOrigin ?? null, routingRevision ?? null, routed ? 1 : 0);
    this.db.prepare('UPDATE tasks SET created_at=?,trigger_message=?,routed_at=? WHERE id=?').run(Date.now(), source?.id ?? null, routed ? Date.now() : null, task.id);
    if (source) this.db.prepare('INSERT INTO feedback (task, message) VALUES (?, ?)').run(task.id, this.replyTarget(task.id)!);
    return task;
  }

  // Internal goal continuation: a real original reply trigger, never a new platform ingress event.
  enqueueContinuation(session: string, input: string, authority: { goal: string; attempt: string; priorCheckpoint: string;
    thread: string; source: NonNullable<Task['source']> }): Task {
    const saved = this.session(session);
    if (!authority.goal || !authority.attempt || !authority.priorCheckpoint || !authority.source.id || !authority.thread ||
      saved.thread !== authority.thread || this.db.prepare('SELECT 1 FROM tasks').get()) throw new Error('Invalid internal continuation authority');
    return this.transaction(() => {
      this.db.exec('CREATE TABLE IF NOT EXISTS continuation_origin (task TEXT PRIMARY KEY REFERENCES tasks(id), authority TEXT NOT NULL)');
      const task = this.enqueue(session, input, authority.source, undefined, undefined, true);
      this.db.prepare('INSERT INTO continuation_origin VALUES (?,?)').run(task.id, JSON.stringify(authority));
      return task;
    });
  }

  queued(directory: string): Task | undefined {
    const row = this.db.prepare(`SELECT tasks.id, tasks.session, tasks.input, tasks.status, tasks.turn, tasks.source, tasks.routed, tasks.routing_origin AS routingOrigin, tasks.routing_revision AS routingRevision FROM tasks
      JOIN sessions ON sessions.id=tasks.session WHERE tasks.status='queued' AND sessions.directory=? ORDER BY tasks.sequence LIMIT 1`)
      .get(directory) as unknown as (Omit<Task, 'source'> & { source: string | null }) | undefined;
    return row ? { ...row, source: row.source ? JSON.parse(row.source) as Task['source'] : undefined } : undefined;
  }

  directories(): string[] {
    return (this.db.prepare(`SELECT DISTINCT directory FROM sessions JOIN tasks ON tasks.session=sessions.id WHERE tasks.status='queued'`)
      .all() as { directory: string }[]).map(row => row.directory);
  }

  executionForTrigger(message: string, owner: string): { id: string; status: string; thread: string | null; turn: string | null; directory: string } | undefined {
    return this.db.prepare('SELECT tasks.id, tasks.status, sessions.thread, tasks.turn, sessions.directory FROM tasks JOIN sessions ON sessions.id=tasks.session WHERE tasks.trigger_message=? AND sessions.owner=? ORDER BY tasks.sequence DESC LIMIT 1')
      .get(message, owner) as { id: string; status: string; thread: string | null; turn: string | null; directory: string } | undefined;
  }

  status(session: string): { status: string; count: number }[] {
    return this.db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE ((routing_origin IS NULL OR routed=1) AND session=?) OR (routed=0 AND routing_origin=?) GROUP BY status').all(session, session) as unknown as { status: string; count: number }[];
  }

  taskSource(task: string, source: Task['source']): void {
    this.db.prepare('UPDATE tasks SET source=? WHERE id=?').run(source ? JSON.stringify(source) : null,task);
  }

  taskStatus(id: string, status: string, turn: string | null = null): void {
    this.db.prepare('UPDATE tasks SET status=?, turn=COALESCE(?, turn), finished_at=CASE WHEN ? THEN COALESCE(finished_at,?) ELSE finished_at END WHERE id=?').run(status, turn, !['queued','running'].includes(status) ? 1 : 0, Date.now(), id);
  }

  uncertainHandoff(task: string, directory: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM tasks prior JOIN sessions ON sessions.id=prior.session
      JOIN tasks incoming ON incoming.id=? WHERE sessions.directory=? AND prior.status='unknown'
      AND prior.finished_at IS NOT NULL AND incoming.created_at <= prior.finished_at LIMIT 1`).get(task,directory));
  }

  phase(task: string, phase: 'routing' | 'execution'): void {
    const field = phase === 'routing' ? 'routing_at' : 'execution_at';
    this.db.prepare(`UPDATE tasks SET ${field}=COALESCE(${field},?) WHERE id=?`).run(Date.now(),task);
  }

  trigger(task: string): string | undefined {
    const row = this.db.prepare('SELECT trigger_message,source FROM tasks WHERE id=?').get(task) as {trigger_message:string|null;source:string|null}|undefined;
    return row?.trigger_message ?? (this.db.prepare('SELECT message FROM feedback WHERE task=?').get(task) as {message:string}|undefined)?.message ?? (row?.source ? JSON.parse(row.source).id : undefined);
  }
  replyTarget(task: string): string | undefined {
    const row = this.db.prepare('SELECT source FROM tasks WHERE id=?').get(task) as { source: string | null } | undefined;
    const source = row?.source ? JSON.parse(row.source) as Task['source'] : undefined;
    return source?.id.startsWith('permission-retry/') ? source.parentId : this.trigger(task);
  }

  referencedTask(message: string, owner: string): string | undefined {
    return (this.db.prepare(`SELECT tasks.id FROM tasks JOIN sessions ON sessions.id=tasks.session
      LEFT JOIN feedback ON feedback.task=tasks.id LEFT JOIN task_messages ON task_messages.task=tasks.id
      WHERE sessions.owner=? AND (tasks.trigger_message=? OR feedback.message=? OR (task_messages.message=? AND task_messages.chat=sessions.chat)) LIMIT 1`).get(owner,message,message,message) as {id:string}|undefined)?.id;
  }

  confirmedAnswer(message: IncomingMessage): string | undefined {
    if (!message.parentId || message.chatType !== 'p2p') return;
    return (this.db.prepare(`SELECT m.task FROM task_messages m JOIN tasks t ON t.id=m.task JOIN sessions s ON s.id=t.session
      WHERE m.message=? AND m.ordinary_answer=1 AND m.chat=? AND s.owner=?`)
      .get(message.parentId, message.chat, ownerKey(message)) as { task: string } | undefined)?.task;
  }

  latest(session: string): { status: string; input: string } | undefined {
    return this.db.prepare(`SELECT status,input FROM tasks WHERE ((routing_origin IS NULL OR routed=1) AND session=?) OR (routed=0 AND routing_origin=?) ORDER BY sequence DESC LIMIT 1`).get(session,session) as {status:string;input:string}|undefined;
  }

  metrics(): Record<string, unknown>[] {
    return this.db.prepare('SELECT created_at,routing_at,routed_at,execution_at,finished_at,feedback_at,delivered_at,status FROM tasks WHERE created_at IS NOT NULL ORDER BY sequence DESC LIMIT 1000').all() as Record<string, unknown>[];
  }

  cancelQueued(directory: string): void {
    const tasks = this.db.prepare(`SELECT tasks.id, sessions.chat, sessions.owner, tasks.routed, tasks.routing_origin FROM tasks JOIN sessions ON sessions.id=tasks.session
      WHERE tasks.status='queued' AND sessions.directory=?`).all(directory) as { id: string; chat: string; owner: string; routed: number; routing_origin: string | null }[];
    this.db.prepare(`UPDATE tasks SET status='interrupted' WHERE status='queued' AND session IN (SELECT id FROM sessions WHERE directory=?)`).run(directory);
    for (const task of tasks) if (!task.routed && task.routing_origin) this.clearPending(task.owner);
    const groups = new Map<string, typeof tasks>();
    for (const task of tasks) { const key=JSON.stringify([task.chat,task.owner]); groups.set(key,[...(groups.get(key)??[]),task]); }
    for (const group of groups.values()) this.send(group[0]!.chat,`${group.length} 个尚未开始的请求已取消。请先核对前一个任务的实际结果，再决定是否重新发起。`,{replyTo:this.replyTarget(group[0]!.id)});

  }

  cancelSessionQueued(session: string): number {
    return Number(this.db.prepare("UPDATE tasks SET status='interrupted',finished_at=? WHERE status='queued' AND (((routing_origin IS NULL OR routed=1) AND session=?) OR (routed=0 AND routing_origin=?))").run(Date.now(),session, session).changes);
  }

  recover(): number {
    return this.transaction(() => {
      this.db.prepare("UPDATE approvals SET status='invalidated' WHERE status='pending'").run();
      const tasks = this.db.prepare(`SELECT tasks.id, sessions.chat, sessions.owner, tasks.routed, tasks.routing_origin FROM tasks JOIN sessions ON sessions.id=tasks.session WHERE status IN ('running','queued')`)
        .all() as { id: string; chat: string; owner: string; routed: number; routing_origin: string | null }[];
      const groups = new Map<string, typeof tasks>();
      for (const task of tasks) {
        if (!task.routed && task.routing_origin) this.clearPending(task.owner);
        this.taskStatus(task.id,'interrupted');
        const key=JSON.stringify([task.chat,task.owner]); groups.set(key,[...(groups.get(key)??[]),task]);
      }
      for (const group of groups.values()) this.send(group[0]!.chat,`上次连接中断，${group.length} 个未完成的请求已停止。请核对已经发生的操作，再重新说明需要继续的部分；不会自动重跑。`,{replyTo:this.replyTarget(group[0]!.id)});
      return tasks.length;
    });
  }

  recordApproval(id: string, task: string, method: string, expires?: number): void {
    this.db.prepare('INSERT INTO approvals (id, task, method, status, created, expires) VALUES (?, ?, ?, ?, ?, ?)').run(id, task, method, 'pending', Date.now(), expires ?? null);
  }

  approvalStatus(id: string, status: string, actor?: string): void {
    this.db.prepare('UPDATE approvals SET status=?, actor=COALESCE(?, actor) WHERE id=?').run(status, actor ?? null, id);
  }

  send(chat: string, body: string, options: DeliveryOptions = {}): void {
    if (options.matterCard) {
      const p = parseMatterPresentation(redactMatterPresentation(options.matterCard, text => this.redact(text)));
      if (p.chat !== chat) throw Error('Matter presentation target differs');
      const insert = () => {
        const id = randomUUID();
        this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to,matter_card) VALUES (?,?,?,?,?)')
          .run(id, chat, p.text, options.replyTo ?? null, JSON.stringify(p));
        this.db.prepare('INSERT INTO matter_cards(id,delivery,payload) VALUES (?,?,?)').run(p.id, id, JSON.stringify(p));
      };
      if (this.db.isTransaction) insert(); else this.transaction(insert);
      return;
    }
    if (options.reviewCard) {
      const p = parseReviewPresentation({ ...options.reviewCard, text: this.redact(options.reviewCard.text) }), id = randomUUID();
      if (p.chat !== chat) throw Error('Review presentation target differs');
      const insert = () => {
        this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to,review_card) VALUES(?,?,?,?,?)').run(id, chat, this.redact(body), options.replyTo ?? null, JSON.stringify(p));
        this.db.prepare('INSERT INTO review_cards(id,delivery,payload) VALUES(?,?,?)').run(p.id, id, JSON.stringify(p));
      };
      if (this.db.isTransaction) insert(); else this.transaction(insert);
      return;
    }
    if (options.taskView) {
      const p = parseTaskPresentation(redactTaskPresentation(options.taskView, text => this.redact(text)));
      if (p.chat !== chat || options.taskId !== p.execution) throw new Error('Task presentation target differs');
      const insert = () => {
        const id = randomUUID();
        this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to,response_task,task_view) VALUES (?,?,?,?,?,?)')
          .run(id, chat, p.text, options.replyTo ?? null, p.execution, JSON.stringify(p));
        this.db.prepare('INSERT INTO task_views(id,execution,delivery,payload) VALUES (?,?,?,?)').run(p.id, p.execution, id, JSON.stringify(p));
      };
      if (this.db.isTransaction) insert(); else this.transaction(insert);
      return;
    }
    if (options.approval) {
      const p = this.redactApproval(options.approval);
      if (options.approval.remember && !p.remember) body = approvalText(p);
      if (Buffer.byteLength(JSON.stringify(approvalCard(p))) <= APPROVAL_CARD_BYTES) {
        parseApproval(p);
        this.transaction(() => {
          const id = randomUUID();
          this.db.prepare('INSERT INTO outbox(id,chat,body,reply_to,response_task,prompt_id,approval) VALUES (?,?,?,?,?,?,?)')
            .run(id, chat, this.redact(body), options.replyTo ?? null, options.taskId ?? null, options.promptId ?? null, JSON.stringify(p));
          this.db.prepare('INSERT INTO approval_cards(id,prompt,delivery,payload) VALUES (?,?,?,?)').run(p.id, p.prompt, id, JSON.stringify(p));
        });
        return;
      }
      if (p.remember) { p.remember = undefined; body = approvalText(p); }
    }
    // Split before persistence so each part retains its UUID across delivery retries.
    for (const part of splitReply(this.redact(body))) {
      this.db.prepare(`INSERT INTO outbox(id,chat,body,reply_to,mentions,response_task,final,prompt_id,ordinary_answer)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(), chat, part, options.replyTo ?? null, options.mentions?.length ? JSON.stringify(options.mentions) : null,
        options.taskId ?? null, options.final ? 1 : 0, options.promptId ?? null, options.final && options.answer ? 1 : 0);
    }
  }

  redact(body: string): string {
    for (const secret of this.secrets) body = body.split(secret).join('[redacted]');
    return body;
  }

  private confirmedMatter(message: string, actor: Pick<MatterClick, 'tenant' | 'user' | 'chat'>): MatterPresentation | undefined {
    const row = this.db.prepare('SELECT payload FROM matter_cards WHERE message=?').get(message) as { payload: string } | undefined;
    if (!row) return;
    const p = parseMatterPresentation(JSON.parse(row.payload));
    return p.tenant === actor.tenant && p.user === actor.user && p.chat === actor.chat ? p : undefined;
  }

  matterCard(click: MatterClick): MatterPresentation | undefined {
    const p = this.confirmedMatter(click.message, click);
    return p?.id === click.id && p.choices.some(c => c.id === click.choice) ? p : undefined;
  }

  enqueueRefundMatter(card: MatterPresentation): void {
    if (card.source !== 'sls-refund') throw Error('Expected refund incident card');
    this.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM matter_cards WHERE id=?').get(card.id) as { payload: string } | undefined;
      if (!row) return this.send(card.chat, card.text, { matterCard: card });
      const previous = parseMatterPresentation(JSON.parse(row.payload));
      if (previous.source !== card.source || previous.anchor !== card.anchor || previous.tenant !== card.tenant ||
        previous.user !== card.user || previous.chat !== card.chat) throw Error('Refund card identity conflicts');
    });
  }

  pendingRefundReference(message: IncomingMessage): boolean {
    if (!message.parentId) return false;
    return Boolean(this.db.prepare(`SELECT 1 FROM matter_cards WHERE message IS NULL
      AND json_extract(payload,'$.source')='sls-refund' AND json_extract(payload,'$.tenant')=?
      AND json_extract(payload,'$.user')=? AND json_extract(payload,'$.chat')=? LIMIT 1`)
      .get(message.tenant, message.user, message.chat));
  }

  matterReference(message: IncomingMessage): MatterPresentation | undefined {
    const card = message.parentId ? this.confirmedMatter(message.parentId, message) : undefined;
    return card?.anchor ? card : undefined;
  }

  taskView(click: TaskRefreshClick): TaskPresentation | undefined {
    const row = this.db.prepare('SELECT payload FROM task_views WHERE id=? AND message=?').get(click.id, click.message) as { payload: string } | undefined;
    if (!row) return;
    const p = parseTaskPresentation(JSON.parse(row.payload));
    return p.tenant === click.tenant && p.user === click.user && p.chat === click.chat ? p : undefined;
  }

  refreshTaskView(presentation: TaskPresentation, message: string): void {
    const p = parseTaskPresentation(redactTaskPresentation(presentation, text => this.redact(text)));
    if (!this.db.prepare('SELECT 1 FROM task_views WHERE id=? AND execution=? AND message=?').get(p.id, p.execution, message)) throw new Error('Unconfirmed task card');
    this.db.prepare('INSERT INTO outbox(id,chat,body,response_task,task_view,update_message) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), p.chat, p.text, p.execution, JSON.stringify(p), message);
  }

  private redactApproval(p: ApprovalPresentation): ApprovalPresentation {
    return { ...p, context: this.redact(p.context), reason: this.redact(p.reason), action: this.redact(p.action),
      remember: p.remember && p.remember.prefix.every(x => this.redact(x) === x) ? p.remember : undefined,
      ...(p.sourceLink && { sourceLink: this.redact(p.sourceLink) }) };
  }

  sendStatus(task: string, chat: string, body: string, promptId?: string): void {
    this.db.prepare('INSERT INTO outbox (id, chat, body, task, reply_to, response_task, prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), chat, this.redact(body), task, this.replyTarget(task) ?? null, task, promptId ?? null);
  }

  feedback(task: string): FeedbackRecord | undefined {
    return this.db.prepare(`SELECT feedback.*, tasks.status, sessions.chat FROM feedback
      JOIN tasks ON tasks.id=feedback.task JOIN sessions ON sessions.id=tasks.session WHERE feedback.task=?`)
      .get(task) as unknown as FeedbackRecord | undefined;
  }

  pendingFeedback(now = Date.now()): FeedbackRecord[] {
    return this.db.prepare(`SELECT feedback.*, tasks.status, sessions.chat FROM feedback
      JOIN tasks ON tasks.id=feedback.task JOIN sessions ON sessions.id=tasks.session WHERE next<=?
      AND (reaction IS NULL OR tasks.status NOT IN ('queued','running')) ORDER BY tasks.sequence LIMIT 10`)
      .all(now) as unknown as FeedbackRecord[];
  }

  feedbackAttempt(task: string): void {
    this.db.prepare('UPDATE feedback SET uncertain=1 WHERE task=?').run(task);
  }

  feedbackAdded(task: string, reaction: string | null): void {
    if (reaction) this.db.prepare('UPDATE tasks SET feedback_at=COALESCE(feedback_at,?) WHERE id=?').run(Date.now(),task);
    this.db.prepare('UPDATE feedback SET reaction=?, uncertain=0, attempts=0, next=0 WHERE task=?').run(reaction, task);
  }

  feedbackFinished(task: string): void { this.db.prepare('DELETE FROM feedback WHERE task=?').run(task); }

  feedbackRetry(row: FeedbackRecord): void {
    this.transaction(() => {
      const current = this.feedback(row.task);
      if (current && !current.fallback && ['queued', 'running'].includes(current.status) && !current.reaction) {
        this.sendStatus(row.task, row.chat, '收到，我来看看。');
        this.db.prepare('UPDATE feedback SET fallback=1 WHERE task=?').run(row.task);
      }
      this.db.prepare('UPDATE feedback SET attempts=attempts+1, next=? WHERE task=?').run(
        Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(row.attempts + 1, 6)), row.task);
    });
  }

  pending(now = Date.now()): Delivery[] {
    this.queueCardUpdates(Date.now());
    // A delayed status must never appear after its task has finished.
    this.db.prepare(`DELETE FROM outbox WHERE task IS NOT NULL AND task IN
      (SELECT id FROM tasks WHERE status NOT IN ('queued','running'))`).run();
    this.db.prepare(`DELETE FROM outbox WHERE prompt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM approvals WHERE approvals.id=outbox.prompt_id AND status='pending' AND (expires IS NULL OR expires>?))`).run(Date.now());
    // Preserve message ordering within each chat, even if its first message is backing off.
    const rows = this.db.prepare(`SELECT id, chat, body, attempts, next, reply_to AS replyTo, mentions, response_task AS taskId, final, approval,
      update_message AS updateMessage,approval_view AS approvalView,task_view AS taskView, review_card AS reviewCard, matter_card AS matterCard FROM outbox AS current WHERE next<=?
      AND NOT EXISTS (SELECT 1 FROM outbox AS previous WHERE previous.chat=current.chat AND previous.sequence<current.sequence)
      ORDER BY sequence LIMIT 20`).all(now) as unknown as (Omit<Delivery, 'approval' | 'taskView'> & { approval: string | null; taskView: string | null })[];
    return rows.map(row => ({ ...row, approval: row.approval ? parseApproval(JSON.parse(row.approval)) : undefined,
      reviewCard: row.reviewCard ? parseReviewPresentation(JSON.parse(row.reviewCard as unknown as string)) : undefined, taskView: row.taskView ? parseTaskPresentation(JSON.parse(row.taskView)) : undefined,
      matterCard: row.matterCard ? parseMatterPresentation(JSON.parse(row.matterCard as unknown as string)) : undefined }));
  }

  deliveryReady(id: string): boolean {
    // Recheck each selected status just before HTTP; another chat may have
    // blocked delivery while this task finished. In-flight requests cannot be recalled.
    const current = this.db.prepare(`SELECT 1 FROM outbox WHERE id=? AND (task IS NULL OR EXISTS
      (SELECT 1 FROM tasks WHERE tasks.id=outbox.task AND tasks.status IN ('queued','running'))) AND (prompt_id IS NULL OR EXISTS (SELECT 1 FROM approvals WHERE approvals.id=outbox.prompt_id AND status='pending' AND (expires IS NULL OR expires>?)))`).get(id,Date.now());
    if (!current) this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
    return Boolean(current);
  }

  delivered(id: string, message?: string): void {
    const card = this.db.prepare(`SELECT update_message,approval_view,task_view,review_card,matter_card,response_task,chat,
      ordinary_answer AND EXISTS(SELECT 1 FROM projected_deliveries WHERE projected_deliveries.id=outbox.id) AS ordinary_answer
      FROM outbox WHERE id=?`).get(id) as {
      update_message: string | null; approval_view: string | null; task_view: string | null; review_card: string | null; matter_card: string | null;
      ordinary_answer: number; response_task: string | null; chat: string;
    } | undefined;
    if (card?.ordinary_answer && card.response_task) {
      if (!message) throw new Error('Answer delivery has no confirmed message ID');
      this.transaction(() => {
        const saved = this.db.prepare(`INSERT INTO task_messages(message,task,chat,ordinary_answer) VALUES (?,?,?,1)
          ON CONFLICT(message) DO UPDATE SET ordinary_answer=1
          WHERE task=excluded.task AND chat=excluded.chat AND ordinary_answer=1`)
          .run(message, card.response_task, card.chat);
        if (!saved.changes) throw new Error('Answer delivery identity changed');
        this.db.prepare('UPDATE tasks SET delivered_at=COALESCE(delivered_at,?) WHERE id=?').run(Date.now(), card.response_task);
        this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
      });
      return;
    }
    if (card?.matter_card) {
      if (!message) throw new Error('Matter card delivery has no confirmed message ID');
      this.transaction(() => {
        const updated = this.db.prepare(`UPDATE matter_cards SET message=? WHERE delivery=? AND (message IS NULL OR message=?)`)
          .run(message, id, message);
        if (!updated.changes) throw new Error('Matter card delivery identity changed');
        this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
      });
      return;
    }
    if (card?.review_card) {
      if (message) this.db.prepare('UPDATE review_cards SET message=COALESCE(message,?) WHERE delivery=?').run(message, id);
    }
    else if (card?.task_view) {
      const p = parseTaskPresentation(JSON.parse(card.task_view));
      if (card.update_message) this.db.prepare('UPDATE task_views SET payload=? WHERE id=? AND message=?').run(card.task_view, p.id, card.update_message);
      else if (message) this.db.prepare('UPDATE task_views SET message=? WHERE delivery=?').run(message, id);
    }
    else if (card?.update_message) this.db.prepare('UPDATE approval_cards SET rendered=? WHERE message=?').run(card.approval_view!, card.update_message);
    else if (message) this.db.prepare('UPDATE approval_cards SET message=? WHERE delivery=?').run(message, id);
    const delivery = this.db.prepare('SELECT response_task AS task,final,chat FROM outbox WHERE id=?').get(id) as {task:string|null;final:number;chat:string}|undefined;
    if (delivery?.task) {
      if (message) this.db.prepare('INSERT OR IGNORE INTO task_messages (message,task,chat) VALUES (?,?,?)').run(message,delivery.task,delivery.chat);
      if (!card?.task_view) {
        const field = delivery.final ? 'delivered_at' : 'feedback_at';
        this.db.prepare(`UPDATE tasks SET ${field}=COALESCE(${field},?) WHERE id=?`).run(Date.now(),delivery.task);
      }
    }
    if (message) this.db.prepare('UPDATE review_cards SET message=COALESCE(message,?) WHERE delivery=?').run(message, id);
    this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
  }

  private cardView(prompt: string, now: number): ApprovalView {
    const row = this.db.prepare('SELECT approvals.status,actor,expires,tasks.status AS task_status FROM approvals JOIN tasks ON tasks.id=approvals.task WHERE approvals.id=?')
      .get(prompt) as { status: string; actor: string | null; expires: number | null; task_status: string } | undefined;
    if (row?.status === 'remember_sent') return 'remembered';
    if (row?.status === 'accept_sent') return 'approved';
    if (row?.status === 'decline_sent' && row.actor) return 'rejected';
    if (row?.expires != null && row.expires <= now) return 'expired';
    return row?.status === 'pending' && row.task_status === 'running' ? 'pending' : 'unavailable';
  }

  private cardChanges(now: number) {
    const cards = this.db.prepare('SELECT * FROM approval_cards WHERE message IS NOT NULL').all() as { id: string; prompt: string; payload: string; message: string; rendered: ApprovalView }[];
    const changed: { payload: string; message: string; view: ApprovalView }[] = [];
    for (const card of cards) {
      const view = this.cardView(card.prompt, now);
      if (view === card.rendered || this.db.prepare('SELECT 1 FROM outbox WHERE update_message=?').get(card.message)) continue;
      changed.push({ payload: card.payload, message: card.message, view });
    }
    return changed;
  }

  private queueCardUpdates(now: number): void {
    for (const card of this.cardChanges(now)) {
      const p = parseApproval(JSON.parse(card.payload));
      this.db.prepare('INSERT INTO outbox(id,chat,body,approval,update_message,approval_view) VALUES (?,?,?,?,?,?)')
        .run(randomUUID(), p.chat, '', card.payload, card.message, card.view);
    }
  }

  rememberApprovalTarget(task: string, token: string, message: IncomingMessage): NativeControlTarget | undefined {
    if (message.chatType !== 'p2p') return;
    const row = this.db.prepare(`SELECT c.payload,c.prompt FROM approval_cards c JOIN approvals a ON a.id=c.prompt
      JOIN tasks t ON t.id=a.task JOIN sessions s ON s.id=t.session
      WHERE a.task=? AND a.id=? AND s.owner=? AND c.message IS NOT NULL ORDER BY c.rowid DESC LIMIT 1`)
      .get(task, task + ':' + token, ownerKey(message)) as { payload: string; prompt: string } | undefined;
    if (!row || this.cardView(row.prompt, Date.now()) !== 'pending') return;
    const p = parseApproval(JSON.parse(row.payload));
    return p.remember && p.tenant === message.tenant && p.chat === message.chat ? p.target : undefined;
  }

  approvalClick(click: ApprovalClick) {
    const row = this.db.prepare('SELECT approval_cards.*,approvals.task FROM approval_cards JOIN approvals ON approvals.id=approval_cards.prompt WHERE approval_cards.id=?').get(click.id) as
      { payload: string; prompt: string; task: string; message: string | null } | undefined;
    if (!row || row.message !== click.message || this.cardView(row.prompt, Date.now()) !== 'pending') return;
    const p = parseApproval(JSON.parse(row.payload));
    if (p.tenant !== click.tenant || p.chat !== click.chat || click.decision === 'approve_save' && !p.remember) return;
    return { task: row.task, target: p.target, message: cardMessage(click, p), prompt: p.prompt };
  }

  retry(delivery: Delivery): void {
    const attempts = delivery.attempts + 1;
    this.db.prepare('UPDATE outbox SET attempts=?, next=? WHERE id=?').run(
      attempts, Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)), delivery.id,
    );
  }

  reviewCard(click: ReviewClick): ReviewPresentation | undefined {
    const row = this.db.prepare('SELECT payload,message FROM review_cards WHERE id=?').get(click.id) as { payload: string; message: string | null } | undefined;
    if (!row || row.message !== click.message) return;
    const p = parseReviewPresentation(JSON.parse(row.payload));
    return p.tenant === click.tenant && p.user === click.user && p.chat === click.chat && p.expires > Date.now() ? p : undefined;
  }
  publishReview(p: ReviewPresentation, replyTo: string, interactive = true): void {
    this.transaction(() => {
      if (this.db.prepare('INSERT OR IGNORE INTO review_notices VALUES(?)').run(p.review).changes) this.send(p.chat, p.text, { replyTo, reviewCard: interactive ? p : undefined });
    });
  }
  finishReviewCard(id: string, text: string): void {
    const row = this.db.prepare('SELECT payload,message FROM review_cards WHERE id=?').get(id) as { payload: string; message: string | null } | undefined;
    if (!row?.message) return;
    const p = parseReviewPresentation({ ...JSON.parse(row.payload), text: this.redact(text), retry: false, consumed: true });
    const update = () => {
      this.db.prepare('UPDATE review_cards SET payload=? WHERE id=?').run(JSON.stringify(p), id);
      this.db.prepare('INSERT INTO outbox(id,chat,body,review_card,update_message) VALUES(?,?,?,?,?)').run(randomUUID(), p.chat, '', JSON.stringify(p), row.message);
    };
    if (this.db.isTransaction) update(); else this.transaction(update);
  }

  recordBrowserAccessBlock(task: string, generation: string, denial: Omit<BrowserAccessBlock, 'task' | 'generation' | 'observedAt'>): void {
    const previous = this.db.prepare('SELECT body FROM browser_access_blocks WHERE task=? AND generation=? AND item=?').get(task, generation, denial.item) as { body: string } | undefined;
    if (previous) {
      const old = JSON.parse(previous.body) as BrowserAccessBlock;
      if (old.origin !== denial.origin || old.browser !== denial.browser || old.code !== denial.code) throw Error('Browser access observation changed');
      return;
    }
    const observation: BrowserAccessBlock = { task, generation, ...denial, observedAt: Date.now() };
    this.db.prepare('INSERT INTO browser_access_blocks VALUES(?,?,?,?)').run(task, generation, denial.item, JSON.stringify(observation));
  }
  browserAccessBlocks(task: string, generation: string): BrowserAccessBlock[] {
    return readBrowserAccessBlocks(this.db, task, generation)!;
  }

  recordNativeReview(generation: string, review: import('./permissions.js').NativeReview): void {
    const body = JSON.stringify(review);
    const previous = this.db.prepare('SELECT body FROM native_permission_reviews WHERE id=? AND generation=?').get(review.id, generation) as { body: string } | undefined;
    if (previous && previous.body !== body) throw Error('Native review observation changed');
    this.db.prepare('INSERT OR IGNORE INTO native_permission_reviews VALUES(?,?,?)').run(review.id, generation, body);
  }

  close(): void { this.db.close(); }
}
