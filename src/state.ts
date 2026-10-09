import { chmodSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { splitReply } from './reply.js';
import { ownerKey, type IncomingMessage, type Session, type Task, type DeliveryOptions } from './types.js';

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
}

export interface FeedbackRecord {
  task: string; message: string; chat: string; status: string;
  reaction: string | null; uncertain: number; fallback: number; attempts: number; next: number;
}

export class State {
  private db: DatabaseSync;
  private secrets: string[];

  constructor(directory: string, secrets: string[] = []) {
    this.secrets = secrets.filter(secret => secret.length > 4).sort((a, b) => b.length - a.length);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('State directory must not be a symlink');
    chmodSync(realpathSync(directory), 0o700);
    try {
      if (lstatSync(join(directory, 'bridge.db')).isSymbolicLink()) throw new Error('State database must not be a symlink');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.db = new DatabaseSync(join(directory, 'bridge.db'));
    chmodSync(join(directory, 'bridge.db'), 0o600);
    this.db.exec(`
      PRAGMA journal_mode=DELETE;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS seen (tenant TEXT, id TEXT, PRIMARY KEY (tenant, id));
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, owner TEXT, tenant TEXT, user TEXT, chat TEXT,
        project TEXT, directory TEXT, thread TEXT
      );
      CREATE TABLE IF NOT EXISTS selections (owner TEXT PRIMARY KEY, session TEXT REFERENCES sessions(id));
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
    for (const [name, definition] of Object.entries({ reply_to: 'TEXT', mentions: 'TEXT', response_task: 'TEXT', final: 'INTEGER DEFAULT 0', prompt_id: 'TEXT' })) {
      if (!outboxColumns.some(column => column.name === name)) this.db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec('CREATE TABLE IF NOT EXISTS task_messages (message TEXT PRIMARY KEY, task TEXT REFERENCES tasks(id), chat TEXT)');
    if (!taskColumns.some(column => column.name === 'trigger_message')) this.db.exec('ALTER TABLE tasks ADD COLUMN trigger_message TEXT');
    if (!(this.db.prepare('PRAGMA table_info(task_messages)').all() as {name:string}[]).some(column=>column.name==='chat')) this.db.exec('ALTER TABLE task_messages ADD COLUMN chat TEXT');
    for (const field of ['created_at','routing_at','routed_at','execution_at','finished_at','feedback_at','delivered_at']) {
      if (!taskColumns.some(column => column.name === field)) this.db.exec(`ALTER TABLE tasks ADD COLUMN ${field} INTEGER`);
    }
    const approvalColumns = this.db.prepare('PRAGMA table_info(approvals)').all() as { name: string }[];
    if (!approvalColumns.some(column => column.name === 'expires')) this.db.exec('ALTER TABLE approvals ADD COLUMN expires INTEGER');
    if (!approvalColumns.some(column => column.name === 'actor')) this.db.exec('ALTER TABLE approvals ADD COLUMN actor TEXT');
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

  remember(message: IncomingMessage): boolean {
    return Number(this.db.prepare('INSERT OR IGNORE INTO seen VALUES (?, ?)').run(message.tenant, message.id).changes) === 1;
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
      'SELECT * FROM sessions WHERE owner=? AND project=? AND directory=? ORDER BY rowid DESC LIMIT 1',
    ).get(owner, project, directory) as unknown as Session | undefined;
    if (!existing) {
      existing = { id: randomUUID(), owner, tenant: message.tenant, user: message.user, chat: message.chat, project, directory, thread: null };
      this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        existing.id, owner, message.tenant, message.user, message.chat, project, directory, null,
      );
    }
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
    if (source) this.db.prepare('INSERT INTO feedback (task, message) VALUES (?, ?)').run(task.id, source.id);
    return task;
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

  referencedTask(message: string, owner: string): string | undefined {
    return (this.db.prepare(`SELECT tasks.id FROM tasks JOIN sessions ON sessions.id=tasks.session
      LEFT JOIN feedback ON feedback.task=tasks.id LEFT JOIN task_messages ON task_messages.task=tasks.id
      WHERE sessions.owner=? AND (tasks.trigger_message=? OR feedback.message=? OR (task_messages.message=? AND task_messages.chat=sessions.chat)) LIMIT 1`).get(owner,message,message,message) as {id:string}|undefined)?.id;
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
    for (const group of groups.values()) this.send(group[0]!.chat,`${group.length} 个尚未开始的请求已取消。请先核对前一个任务的实际结果，再决定是否重新发起。`,{replyTo:this.trigger(group[0]!.id)});

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
      for (const group of groups.values()) this.send(group[0]!.chat,`上次连接中断，${group.length} 个未完成的请求已停止。请核对已经发生的操作，再重新说明需要继续的部分；不会自动重跑。`,{replyTo:this.trigger(group[0]!.id)});
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
    // Split before persistence so each part retains its UUID across delivery retries.
    for (const part of splitReply(this.redact(body))) {
      this.db.prepare('INSERT INTO outbox (id, chat, body, reply_to, mentions, response_task, final, prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), chat, part, options.replyTo ?? null, options.mentions?.length ? JSON.stringify(options.mentions) : null, options.taskId ?? null, options.final ? 1 : 0, options.promptId ?? null);
    }
  }

  private redact(body: string): string {
    for (const secret of this.secrets) body = body.split(secret).join('[redacted]');
    return body;
  }

  sendStatus(task: string, chat: string, body: string, promptId?: string): void {
    this.db.prepare('INSERT INTO outbox (id, chat, body, task, reply_to, response_task, prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), chat, this.redact(body), task, this.trigger(task) ?? null, task, promptId ?? null);
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
    // A delayed status must never appear after its task has finished.
    this.db.prepare(`DELETE FROM outbox WHERE task IS NOT NULL AND task IN
      (SELECT id FROM tasks WHERE status NOT IN ('queued','running'))`).run();
    this.db.prepare(`DELETE FROM outbox WHERE prompt_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM approvals WHERE approvals.id=outbox.prompt_id AND status='pending' AND (expires IS NULL OR expires>?))`).run(Date.now());
    // Preserve message ordering within each chat, even if its first message is backing off.
    return this.db.prepare(`SELECT id, chat, body, attempts, next, reply_to AS replyTo, mentions, response_task AS taskId, final FROM outbox AS current WHERE next<=?
      AND NOT EXISTS (SELECT 1 FROM outbox AS previous WHERE previous.chat=current.chat AND previous.sequence<current.sequence)
      ORDER BY sequence LIMIT 20`).all(now) as unknown as Delivery[];
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
    const delivery = this.db.prepare('SELECT response_task AS task,final,chat FROM outbox WHERE id=?').get(id) as {task:string|null;final:number;chat:string}|undefined;
    if (delivery?.task) {
      if (message) this.db.prepare('INSERT OR IGNORE INTO task_messages (message,task,chat) VALUES (?,?,?)').run(message,delivery.task,delivery.chat);
      const field = delivery.final ? 'delivered_at' : 'feedback_at';
      this.db.prepare(`UPDATE tasks SET ${field}=COALESCE(${field},?) WHERE id=?`).run(Date.now(),delivery.task);
    }
    this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
  }

  retry(delivery: Delivery): void {
    const attempts = delivery.attempts + 1;
    this.db.prepare('UPDATE outbox SET attempts=?, next=? WHERE id=?').run(
      attempts, Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6)), delivery.id,
    );
  }

  close(): void { this.db.close(); }
}
