import { chmodSync, mkdirSync, realpathSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { splitReply } from './reply.js';
import { ownerKey, type IncomingMessage, type Session, type Task } from './types.js';

export interface Delivery {
  id: string;
  chat: string;
  body: string;
  attempts: number;
  next: number;
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
      CREATE TABLE IF NOT EXISTS routing (owner TEXT PRIMARY KEY, thread TEXT, pending TEXT);
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
    const taskColumns = this.db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
    if (!taskColumns.some(column => column.name === 'source')) this.db.exec('ALTER TABLE tasks ADD COLUMN source TEXT');
    if (!taskColumns.some(column => column.name === 'routed')) this.db.exec('ALTER TABLE tasks ADD COLUMN routed INTEGER DEFAULT 0');
    if (!taskColumns.some(column => column.name === 'diagnostic')) this.db.exec('ALTER TABLE tasks ADD COLUMN diagnostic TEXT');
    if (!taskColumns.some(column => column.name === 'routing_origin')) this.db.exec('ALTER TABLE tasks ADD COLUMN routing_origin TEXT');
    const outboxColumns = this.db.prepare('PRAGMA table_info(outbox)').all() as { name: string }[];
    if (!outboxColumns.some(column => column.name === 'task')) this.db.exec('ALTER TABLE outbox ADD COLUMN task TEXT');
    const approvalColumns = this.db.prepare('PRAGMA table_info(approvals)').all() as { name: string }[];
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

  select(message: IncomingMessage, project: string, directory: string, fresh = false, activate = true): Session {
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
    if (activate) this.db.prepare('INSERT INTO selections VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET session=excluded.session').run(owner, existing.id);
    return existing;
  }

  setThread(session: string, thread: string): void {
    this.db.prepare('UPDATE sessions SET thread=? WHERE id=?').run(thread, session);
  }

  routing(owner: string): { thread: string; pending: string | null } | undefined {
    return this.db.prepare('SELECT thread,pending FROM routing WHERE owner=?').get(owner) as { thread: string; pending: string | null } | undefined;
  }

  setRouting(owner: string, thread: string, pending: string | null): void {
    this.db.prepare('INSERT INTO routing VALUES (?,?,?) ON CONFLICT(owner) DO UPDATE SET thread=excluded.thread,pending=excluded.pending').run(owner, thread, pending);
  }
  clearRouting(owner: string): void { this.db.prepare('DELETE FROM routing WHERE owner=?').run(owner); }
  clearPending(owner: string): void { this.db.prepare('UPDATE routing SET pending=NULL WHERE owner=?').run(owner); }

  routeTask(id: string, session: string, input: string): void {
    this.db.prepare("UPDATE tasks SET session=?,input=?,routed=1,status='queued',turn=NULL WHERE id=? AND status='running'").run(session, input, id);
  }

  diagnostic(id: string, message: string): void { this.db.prepare('UPDATE tasks SET diagnostic=? WHERE id=?').run(message, id); }
  latestDiagnostic(session: string): string | undefined {
    return (this.db.prepare('SELECT diagnostic FROM tasks WHERE session=? ORDER BY sequence DESC LIMIT 1').get(session) as { diagnostic?: string } | undefined)?.diagnostic ?? undefined;
  }

  enqueue(session: string, input: string, source?: Task['source'], routingOrigin?: string): Task {
    const task: Task = { id: randomUUID(), session, input, status: 'queued', turn: null, source };
    this.db.prepare('INSERT INTO tasks (id, session, input, status, source, routing_origin) VALUES (?, ?, ?, ?, ?, ?)').run(task.id, session, input, task.status, source ? JSON.stringify(source) : null, routingOrigin ?? null);
    if (source) this.db.prepare('INSERT INTO feedback (task, message) VALUES (?, ?)').run(task.id, source.id);
    return task;
  }

  queued(directory: string): Task | undefined {
    const row = this.db.prepare(`SELECT tasks.id, tasks.session, tasks.input, tasks.status, tasks.turn, tasks.source, tasks.routed, tasks.routing_origin AS routingOrigin FROM tasks
      JOIN sessions ON sessions.id=tasks.session WHERE tasks.status='queued' AND sessions.directory=? ORDER BY tasks.sequence LIMIT 1`)
      .get(directory) as unknown as (Omit<Task, 'source'> & { source: string | null }) | undefined;
    return row ? { ...row, source: row.source ? JSON.parse(row.source) as Task['source'] : undefined } : undefined;
  }

  directories(): string[] {
    return (this.db.prepare(`SELECT DISTINCT directory FROM sessions JOIN tasks ON tasks.session=sessions.id WHERE tasks.status='queued'`)
      .all() as { directory: string }[]).map(row => row.directory);
  }

  status(session: string): { status: string; count: number }[] {
    return this.db.prepare('SELECT status, COUNT(*) AS count FROM tasks WHERE session=? OR (routed=0 AND routing_origin=?) GROUP BY status').all(session, session) as unknown as { status: string; count: number }[];
  }

  taskStatus(id: string, status: string, turn: string | null = null): void {
    this.db.prepare('UPDATE tasks SET status=?, turn=COALESCE(?, turn) WHERE id=?').run(status, turn, id);
  }

  cancelQueued(directory: string): void {
    const tasks = this.db.prepare(`SELECT tasks.id, sessions.chat FROM tasks JOIN sessions ON sessions.id=tasks.session
      WHERE tasks.status='queued' AND sessions.directory=?`).all(directory) as { id: string; chat: string }[];
    this.db.prepare(`UPDATE tasks SET status='interrupted' WHERE status='queued' AND session IN (SELECT id FROM sessions WHERE directory=?)`).run(directory);
    for (const task of tasks) this.send(task.chat, `排队任务 ${task.id.slice(0, 8)} 已取消。请确认先前任务的实际结果后重新发起。`);
  }

  cancelSessionQueued(session: string): number {
    return Number(this.db.prepare("UPDATE tasks SET status='interrupted' WHERE status='queued' AND (session=? OR (routed=0 AND routing_origin=?))").run(session, session).changes);
  }

  recover(): number {
    return this.transaction(() => {
      this.db.prepare("UPDATE approvals SET status='invalidated' WHERE status='pending'").run();
      const tasks = this.db.prepare(`SELECT tasks.id, sessions.chat FROM tasks JOIN sessions ON sessions.id=tasks.session WHERE status IN ('running','queued')`)
        .all() as { id: string; chat: string }[];
      for (const task of tasks) {
        this.taskStatus(task.id, 'interrupted');
        this.send(task.chat, `任务 ${task.id.slice(0, 8)} 在上次进程退出时未确认完成，已停止。请检查实际结果后重新发起；不会自动重跑。`);
      }
      return tasks.length;
    });
  }

  recordApproval(id: string, task: string, method: string): void {
    this.db.prepare('INSERT INTO approvals (id, task, method, status, created) VALUES (?, ?, ?, ?, ?)').run(id, task, method, 'pending', Date.now());
  }

  approvalStatus(id: string, status: string, actor?: string): void {
    this.db.prepare('UPDATE approvals SET status=?, actor=COALESCE(?, actor) WHERE id=?').run(status, actor ?? null, id);
  }

  send(chat: string, body: string): void {
    // Split before persistence so each part retains its UUID across delivery retries.
    for (const part of splitReply(this.redact(body))) {
      this.db.prepare('INSERT INTO outbox (id, chat, body) VALUES (?, ?, ?)').run(randomUUID(), chat, part);
    }
  }

  private redact(body: string): string {
    for (const secret of this.secrets) body = body.split(secret).join('[redacted]');
    return body;
  }

  sendStatus(task: string, chat: string, body: string): void {
    this.db.prepare('INSERT INTO outbox (id, chat, body, task) VALUES (?, ?, ?, ?)').run(randomUUID(), chat, this.redact(body), task);
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
    // Preserve message ordering within each chat, even if its first message is backing off.
    return this.db.prepare(`SELECT id, chat, body, attempts, next FROM outbox AS current WHERE next<=?
      AND NOT EXISTS (SELECT 1 FROM outbox AS previous WHERE previous.chat=current.chat AND previous.sequence<current.sequence)
      ORDER BY sequence LIMIT 20`).all(now) as unknown as Delivery[];
  }

  deliveryReady(id: string): boolean {
    // Recheck each selected status just before HTTP; another chat may have
    // blocked delivery while this task finished. In-flight requests cannot be recalled.
    const current = this.db.prepare(`SELECT 1 FROM outbox WHERE id=? AND (task IS NULL OR EXISTS
      (SELECT 1 FROM tasks WHERE tasks.id=outbox.task AND tasks.status IN ('queued','running')))`).get(id);
    if (!current) this.delivered(id);
    return Boolean(current);
  }

  delivered(id: string): void {
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
