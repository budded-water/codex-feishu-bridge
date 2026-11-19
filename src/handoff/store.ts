import type { BrowserAccessBlock } from '../browser-access.js';
import type { NativeReview } from '../permissions.js';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Maintenance } from '../maintenance.js';
import { openPrivateDatabase } from '../private-database.js';
import { ownerKey, type IncomingMessage, type NativeControlTarget, type ControlDisposition, type ChatContext } from '../types.js';
import { fingerprint, profileDigest, type VerificationProfile } from './verification-profile.js';
import type { VerificationObservation } from './verification-runner.js';
import { RepairStore } from './repair-store.js';
import { DEFAULT_MATTER, MatterStore } from './matter-store.js';

export interface VerificationRecord {
  execution: string; profile: string; digest: string; definition: VerificationProfile;
  phase: 'planned' | 'running' | 'observed' | 'skipped' | 'unknown'; observation: VerificationObservation | null;
}
export interface BrowserRetry { sourceExecution: string; generation: string; checkpoint: string; thread: string; turn: string; blocks: BrowserAccessBlock[] }
export interface PermissionRetry { sourceExecution: string; generation: string; checkpoint: string; review: NativeReview }
export type VerificationSelection = { profile: string; definition: VerificationProfile; repair?: true };

export type RequestRecord = {
  id: string; execution: string; conversation: string; project: string;
  message: IncomingMessage; input: string; blocked: string | null;
};
export type ControlRecord = { origin: string; execution: string; message: IncomingMessage; target: NativeControlTarget | null;
  status: 'received' | ControlDisposition; result: string | null };
export type TaskReplyRecord = {
  origin: string; request: string; message: IncomingMessage;
  kind: 'merged' | 'live' | 'followup' | 'rejected'; result: string | null; followup: string | null;
};
export type RecoveryRecord = { origin: string; execution: string; actor: string; evidence: string; created: number };
export type WithdrawalRecord = { origin: string; request: string; actor: string; previous_blocked: string | null; previous_problem: string | null; created: number };
export const OWNER_WITHDRAWN = 'owner_withdrawn';
export const QUOTED_CONVERSATION_CHANGED = 'quoted_conversation_changed';
export type Submission = { request: string; event: number | null; attempts: number };
export type Permit = { execution: string; token: string };
export type ExecutionRecord = {
  id: string; request: string; project: string; status: 'active' | 'unknown' | 'completed' | 'interrupted';
  evidence: string | null; problem: string | null;
};
export type Reservation = { kind: 'start'; permit: Permit; request: RequestRecord } |
  { kind: 'existing'; execution: ExecutionRecord } | { kind: 'blocked' | 'busy' | 'withdrawn' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const settledTaskReplyDecisions = `SELECT q.origin FROM task_replies q JOIN controls c ON c.origin=q.origin
  JOIN executions e ON e.id=c.execution WHERE q.kind='live' AND c.status IN ('received','rejected') AND e.status<>'active'`;

export class AdmissionStore {
  private db: DatabaseSync;
  readonly maintenance: Maintenance;
  readonly repairs: RepairStore;
  readonly matters: MatterStore;

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
        CREATE TABLE IF NOT EXISTS browser_retries (execution TEXT PRIMARY KEY REFERENCES requests(execution), source_execution TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS permission_retries (execution TEXT PRIMARY KEY REFERENCES requests(execution), source_execution TEXT NOT NULL, review_id TEXT NOT NULL, body TEXT NOT NULL, UNIQUE(source_execution,review_id));
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
        CREATE TABLE IF NOT EXISTS task_replies (
          origin TEXT PRIMARY KEY, request TEXT NOT NULL REFERENCES requests(id), message TEXT NOT NULL,
          kind TEXT NOT NULL, result TEXT, followup TEXT REFERENCES requests(id)
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
        CREATE TABLE IF NOT EXISTS verifications (
          execution TEXT PRIMARY KEY REFERENCES requests(execution), profile TEXT NOT NULL, digest TEXT NOT NULL,
          definition TEXT NOT NULL, phase TEXT NOT NULL, observation TEXT
        );
      `);
      this.repairs = new RepairStore(this.db, permit => { this.startableRequest(permit); });
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS live_task_replies ON task_replies(request) WHERE kind='live';
        CREATE UNIQUE INDEX IF NOT EXISTS task_reply_followup ON task_replies(followup) WHERE followup IS NOT NULL;
        CREATE INDEX IF NOT EXISTS pending_submissions ON submissions(next) WHERE status='pending';
        CREATE INDEX IF NOT EXISTS live_reference_context ON reference_context(execution) WHERE body IS NOT NULL;
        CREATE INDEX IF NOT EXISTS unblocked_group_requests ON requests(origin)
          WHERE blocked IS NULL AND json_extract(message,'$.chatType')='group';
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
      this.matters = new MatterStore(this.db, work => this.transaction(work));
    } catch (error) { this.db.close(); throw error; }
  }

  private transaction<T>(work: () => T): T {
    if (this.db.isTransaction) return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  bindChannel(kind: string, externalId: string): void {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO channel_binding VALUES (?,?)').run(kind, externalId);
      if (!this.channelBound(kind, externalId)) throw new Error('Channel identity changed');
    });
  }

  channelBound(kind: string, externalId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM channel_binding WHERE kind=? AND external_id=?').get(kind, externalId));
  }

  request(id: string): RequestRecord | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE id=?').get(id) as Omit<RequestRecord, 'message'> & { message: string } | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage };
  }

  requestForMessage(message: IncomingMessage): RequestRecord | undefined {
    const row = this.db.prepare('SELECT id FROM requests WHERE origin=?').get(JSON.stringify([message.tenant, message.id])) as { id: string } | undefined;
    return row && this.request(row.id);
  }

  accept(message: IncomingMessage, input: string, project: string, verification?: VerificationSelection, conversation?: string):
    { duplicate: boolean; request: RequestRecord } | { paused: true } {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM recoveries WHERE origin=? UNION SELECT 1 FROM controls WHERE origin=? UNION SELECT 1 FROM withdrawals WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already belongs to a control');
      const previous = this.db.prepare('SELECT id FROM requests WHERE origin=?').get(origin) as { id: string } | undefined;
      if (previous) return { duplicate: true, request: this.request(previous.id)! };
      if (this.taskReply(origin)) throw new Error('Message identity already belongs to a task reply');
      const held = this.matters.held(message, project);
      if (held && !held.chosen) throw new Error('Task is awaiting matter selection');
      if (this.maintenance.paused) {
        this.retainRefusal(message, 'maintenance');
        return { paused: true };
      }
      return { duplicate: false, request: this.insertRequest(message, input, project, verification, conversation) };
    });
  }

  private insertRequest(message: IncomingMessage, input: string, project: string, verification?: VerificationSelection, selected?: string): RequestRecord {
    const owner = ownerKey(message);
    if (!selected) this.db.prepare('INSERT OR IGNORE INTO conversations(id,owner,project) VALUES (?,?,?)').run(randomUUID(), owner, project);
    const conversation = (selected
      ? this.db.prepare('SELECT id FROM conversations WHERE owner=? AND project=? AND id=?').get(owner, project, selected)
      : this.db.prepare('SELECT id FROM conversations WHERE owner=? AND project=? AND title IS NULL').get(owner, project)
    ) as { id: string } | undefined;
    if (!conversation) throw Error('Conversation does not belong to the owner and project');
    const request: RequestRecord = { id: randomUUID(), execution: randomUUID(), conversation: conversation.id, project,
      message, input, blocked: this.uncertainProject(project) ? 'project_outcome_unknown' : null };
    this.db.prepare('INSERT INTO requests VALUES (?,?,?,?,?,?,?,?)').run(request.id, request.execution, request.conversation,
      project, JSON.stringify([message.tenant, message.id]), JSON.stringify(message), input, request.blocked);
    if (verification?.repair) this.repairs.admit(request.execution, verification, Boolean(request.blocked));
    else if (verification) this.db.prepare('INSERT INTO verifications VALUES (?,?,?,?,?,NULL)')
      .run(request.execution, verification.profile, profileDigest(verification.definition), JSON.stringify(verification.definition), request.blocked ? 'skipped' : 'planned');
    if (!request.blocked) this.db.prepare("INSERT INTO submissions(request,status) VALUES (?,'pending')").run(request.id);
    return request;
  }

  private uncertainProject(project: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM guards JOIN executions ON executions.id=guards.execution WHERE guards.project=? AND executions.status='unknown'").get(project));
  }

  taskReply(origin: string): TaskReplyRecord | undefined {
    const row = this.db.prepare('SELECT * FROM task_replies WHERE origin=?').get(origin) as
      (Omit<TaskReplyRecord, 'message'> & { message: string }) | undefined;
    return row && { ...row, message: JSON.parse(row.message) as IncomingMessage };
  }

  hasDedicatedContinuation(execution: string): boolean {
    return Boolean(this.verification(execution) || this.repairs.get(execution) ||
      this.permissionRetry(execution) || this.browserRetry(execution));
  }

  acceptTaskReply(message: IncomingMessage, project: string, answerExecution?: string) {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.taskReply(origin) || this.db.prepare('SELECT 1 FROM requests WHERE origin=? UNION SELECT 1 FROM controls WHERE origin=? UNION SELECT 1 FROM recoveries WHERE origin=?').get(origin, origin, origin) ||
        this.retained(message)) return { status: 'duplicate' as const };
      const held = this.matters.held(message, project);
      if ((held && (!held.chosen || held.answerExecution !== answerExecution)) || this.matters.notice(message)) return;
      const quotedOrigin = JSON.stringify([message.tenant, message.parentId]);
      const source = this.db.prepare(`SELECT r.id,r.origin FROM requests r JOIN conversations c ON c.id=r.conversation
        WHERE (r.origin=? OR r.execution=?) AND c.owner=? AND r.project=? AND json_extract(r.message,'$.chatType')='p2p'
        ORDER BY (r.origin=?) DESC LIMIT 1`)
        .get(quotedOrigin, answerExecution ?? null, ownerKey(message), project, quotedOrigin) as { id: string; origin: string } | undefined;
      if (!source) return;
      const fromAnswer = source.origin !== quotedOrigin;
      const request = this.request(source.id)!;
      if (held) {
        const matter = this.matters.owned({ owner: ownerKey(message), project }, request.conversation)?.id ?? DEFAULT_MATTER;
        if (!fromAnswer || held.chosen !== matter) return;
      }
      const execution = this.execution(request.execution);
      const text = '用户补充要求：\n' + message.text;
      const combined = request.input + '\n\n' + text;
      const save = (kind: TaskReplyRecord['kind'], result: string | null) => {
        this.db.prepare('INSERT INTO task_replies VALUES (?,?,?,?,?,NULL)').run(origin, request.id, JSON.stringify(message), kind, result);
        // A reverse migration must retain the Feishu message identity for every disposition, even an in-place merge.
        this.db.prepare("INSERT INTO retained_receipts VALUES (?,?,'task_reply')").run(message.tenant, message.id);
      };
      if (this.maintenance.paused || request.blocked || this.submission(request.id)?.status === 'blocked' || this.uncertainProject(project)) {
        save('rejected', '当前任务无法接收补充。请查看原任务状态后再发送新消息。');
      } else if (this.hasDedicatedContinuation(request.execution)) {
        save('rejected', '这条任务使用专用验证、修复或续接流程。请使用原任务的操作入口，或发送新的普通任务。');
      } else if (!fromAnswer && !execution) {
        if (combined.length > 30_000) save('rejected', '合并后的任务过长。这条补充未加入，请缩短后再回复。');
        else {
          this.db.prepare('UPDATE requests SET input=? WHERE id=?').run(combined, request.id);
          save('merged', '已补到原任务，将一起执行。');
        }
      } else if (!fromAnswer && execution?.status === 'active') {
        if (message.text.length > 29_993) save('rejected', '补充内容过长，请缩短后再回复。');
        else {
          this.acceptControl(execution.id, message);
          save('live', null);
        }
      } else {
        save('live', null);
        this.finishTaskReply(this.taskReply(origin)!, request, held?.input ?? undefined);
      }
      return { status: 'task-reply' as const };
    });
  }

  finishTaskReplies(): void {
    const candidates = this.db.prepare(settledTaskReplyDecisions).all() as { origin: string }[];
    for (const { origin } of candidates) this.transaction(() => {
      const reply = this.taskReply(origin)!;
      const control = this.control(reply.message);
      const request = this.request(reply.request)!;
      if (reply.kind !== 'live' || !control || !['received', 'rejected'].includes(control.status) || this.execution(request.execution)?.status === 'active') return;
      this.finishTaskReply(reply, request);
      if (control.status === 'received') this.controlResult(reply.message, 'rejected');
    });
  }

  private finishTaskReply(reply: TaskReplyRecord, request: RequestRecord, chosenInput = reply.message.text): void {
    const source = this.db.prepare('SELECT status,evidence,native_thread,native_turn FROM executions WHERE id=?')
      .get(request.execution) as { status: string; evidence: string | null; native_thread: string | null; native_turn: string | null } | undefined;
    let failure: string | undefined;
    if (this.maintenance.paused || this.uncertainProject(request.project)) failure = '当前无法排入追问，请核对任务状态后再发送新消息。';
    else if (!source || !['completed', 'interrupted'].includes(source.status) || !source.evidence?.startsWith('native-checkpoint/') ||
      !source.native_thread || !source.native_turn || this.conversationThread(request.conversation) !== source.native_thread) {
      failure = '原任务的执行结果或会话尚无法确认，这条回复未排为追问。请查看原任务。';
    }
    const original = Array.from(request.message.text).slice(0, 1000).join('');
    const input = '本次用户追问：\n' + chosenInput +
      '\n\n被回复任务的原始需求（节选，仅作上下文，按本次追问执行）：\n' + original;
    if (input.length > 30_000) failure ??= '追问内容过长，请缩短后再回复。';
    if (failure) {
      this.db.prepare("UPDATE task_replies SET kind='rejected',result=? WHERE origin=?").run(failure, reply.origin);
    } else {
      const followup = this.insertRequest(reply.message, input, request.project, undefined, request.conversation);
      this.db.prepare("UPDATE task_replies SET kind='followup',result=?,followup=? WHERE origin=?")
        .run('原任务已结束，已排为原会话的后续追问。', followup.id, reply.origin);
    }
  }

  permissionRetry(execution: string): PermissionRetry | undefined {
    const row = this.db.prepare('SELECT body FROM permission_retries WHERE execution=?').get(execution) as { body: string } | undefined;
    return row && JSON.parse(row.body) as PermissionRetry;
  }
  retryForReview(sourceExecution: string, reviewId: string): RequestRecord | undefined {
    const row = this.db.prepare('SELECT execution FROM permission_retries WHERE source_execution=? AND review_id=?').get(sourceExecution, reviewId) as { execution: string } | undefined;
    return row && this.requests().find(r => r.execution === row.execution);
  }

  acceptPermissionRetry(message: IncomingMessage, source: RequestRecord, retry: PermissionRetry, input: string) {
    return this.transaction(() => {
      if (message.chatType !== 'p2p' || ownerKey(message) !== ownerKey(source.message)) throw Error('Retry actor differs');
      const prior = this.db.prepare('SELECT execution FROM permission_retries WHERE source_execution=? AND review_id=?').get(source.execution, retry.review.id) as { execution: string } | undefined;
      if (prior) return { duplicate: true, request: this.requests().find(x => x.execution === prior.execution)! };
      const conversation = this.db.prepare('SELECT thread,last_execution FROM conversations WHERE id=?').get(source.conversation) as { thread: string; last_execution: string } | undefined;
      const latest = this.db.prepare('SELECT id FROM requests WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(source.conversation) as { id: string } | undefined;
      const execution = this.execution(source.execution);
      if (retry.sourceExecution !== source.execution ||
        retry.review.status !== 'denied' || !retry.review.action || !execution || !['completed', 'interrupted'].includes(execution.status) ||
        execution.evidence !== 'native-checkpoint/' + retry.checkpoint || latest?.id !== source.id ||
        conversation?.last_execution !== source.execution || conversation.thread !== retry.review.thread ||
        this.db.prepare('SELECT 1 FROM guards WHERE project=?').get(source.project)) throw Error('Source denial or conversation is stale or protected');
      const result = this.accept(message, input, source.project, undefined, source.conversation);
      if ('paused' in result) return result;
      if (result.request.conversation !== source.conversation || result.request.blocked || result.duplicate) throw Error('Retry admission identity differs');
      this.db.prepare('INSERT INTO permission_retries VALUES(?,?,?,?)').run(result.request.execution, source.execution, retry.review.id, JSON.stringify(retry));
      return result;
    });
  }

  browserRetry(execution: string): BrowserRetry | undefined {
    const row = this.db.prepare('SELECT body FROM browser_retries WHERE execution=?').get(execution) as { body: string } | undefined;
    return row && JSON.parse(row.body) as BrowserRetry;
  }
  browserRetryForSource(source: string): RequestRecord | undefined {
    const row = this.db.prepare('SELECT r.id FROM browser_retries b JOIN requests r ON r.execution=b.execution WHERE b.source_execution=?').get(source) as { id: string } | undefined;
    return row && this.request(row.id);
  }
  assertBrowserRetryCurrent(execution: string): void {
    const retry = this.browserRetry(execution);
    if (!retry) return;
    const request = this.request(this.execution(execution)!.request)!;
    const conversation = this.db.prepare('SELECT thread,last_execution FROM conversations WHERE id=?').get(request.conversation) as { thread: string; last_execution: string } | undefined;
    const source = this.execution(retry.sourceExecution);
    if (conversation?.last_execution !== retry.sourceExecution || conversation.thread !== retry.thread || source?.status !== 'completed' ||
      source.evidence !== 'native-checkpoint/' + retry.checkpoint) throw Error('Browser source conversation advanced before startup');
  }
  acceptBrowserRetry(message: IncomingMessage, source: RequestRecord, retry: BrowserRetry, input: string) {
    return this.transaction(() => {
      if (message.chatType !== 'p2p' || source.message.chatType !== 'p2p' || ownerKey(message) !== ownerKey(source.message)) throw Error('Browser continuation actor differs');
      const previous = this.browserRetryForSource(source.execution);
      if (previous) return { duplicate: true, request: previous };
      const conversation = this.db.prepare('SELECT thread,last_execution FROM conversations WHERE id=?').get(source.conversation) as { thread: string; last_execution: string } | undefined;
      const latest = this.db.prepare('SELECT id FROM requests WHERE conversation=? ORDER BY rowid DESC LIMIT 1').get(source.conversation) as { id: string } | undefined;
      const execution = this.execution(source.execution);
      if (input.length > 30_000 || retry.sourceExecution !== source.execution || !retry.blocks.length || retry.blocks.length > 10 ||
        retry.blocks.some(b => b.generation !== retry.generation) || !execution || execution.status !== 'completed' ||
        execution.evidence !== 'native-checkpoint/' + retry.checkpoint || latest?.id !== source.id ||
        conversation?.last_execution !== source.execution || conversation.thread !== retry.thread ||
        this.verification(source.execution) || this.repairs.get(source.execution) ||
        this.db.prepare('SELECT 1 FROM guards WHERE project=?').get(source.project)) return { rejected: 'source-unavailable' as const };
      const result = this.accept(message, input, source.project, undefined, source.conversation);
      if ('paused' in result) return result;
      if (result.request.conversation !== source.conversation || result.request.blocked || result.duplicate) throw Error('Browser continuation admission differs');
      this.db.prepare('INSERT INTO browser_retries VALUES(?,?,?)').run(result.request.execution, source.execution, JSON.stringify(retry));
      return result;
    });
  }

  retainRefusal(message: IncomingMessage, reason: 'maintenance' | 'outside_pilot'): void {
    this.db.prepare('INSERT OR IGNORE INTO retained_receipts VALUES (?,?,?)').run(message.tenant, message.id, reason);
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

  drainStatus() {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      paused: this.maintenance.paused,
      guards: count('SELECT COUNT(*) AS n FROM guards'),
      queued: count("SELECT COUNT(*) AS n FROM requests WHERE blocked IS NULL AND NOT EXISTS(SELECT 1 FROM executions WHERE executions.request=requests.id) AND NOT EXISTS(SELECT 1 FROM submissions WHERE submissions.request=requests.id AND status='blocked')"),
      publication: count("SELECT COUNT(*) AS n FROM submissions WHERE status='pending'"),
      controls: count(`SELECT COUNT(*) AS n FROM controls WHERE (status IN ('received','dispatching') AND
        EXISTS(SELECT 1 FROM guards WHERE guards.execution=controls.execution)) OR origin IN (${settledTaskReplyDecisions})`),
    };
  }

  requests(): RequestRecord[] {
    return (this.db.prepare('SELECT id FROM requests ORDER BY rowid').all() as { id: string }[]).map(row => this.request(row.id)!);
  }

  unpreparedGroupReferences(): RequestRecord[] {
    // Older gateways could schedule a group request before persisting its reference.
    const rows = this.db.prepare(`SELECT r.id FROM submissions s JOIN requests r ON r.id=s.request
      WHERE s.status IN ('pending','scheduled') AND r.blocked IS NULL AND json_extract(r.message,'$.chatType')='group'
        AND NOT EXISTS(SELECT 1 FROM executions e WHERE e.request=r.id)
        AND NOT EXISTS(SELECT 1 FROM reference_context ref WHERE ref.origin=r.origin AND ref.execution=r.execution)
      ORDER BY r.rowid`).all() as { id: string }[];
    return rows.map(row => this.request(row.id)!);
  }

  recentVerificationRequests(owner: string, project: string): RequestRecord[] {
    const rows = this.db.prepare(`SELECT r.id FROM requests r JOIN conversations c ON c.id=r.conversation
      WHERE c.owner=? AND r.project=? AND (EXISTS(SELECT 1 FROM verifications v WHERE v.execution=r.execution)
        OR EXISTS(SELECT 1 FROM repair_goals g WHERE g.execution=r.execution))
      ORDER BY r.rowid DESC LIMIT 100`).all(owner, project) as { id: string }[];
    return rows.map(row => this.request(row.id)!);
  }

  taskPage(owner: string, project: string, page: number): { total: number; requests: RequestRecord[] } {
    const total = Number((this.db.prepare(`SELECT COUNT(*) n FROM requests r JOIN conversations c ON c.id=r.conversation
      WHERE c.owner=? AND r.project=?`).get(owner, project) as { n: number }).n);
    const rows = this.db.prepare(`SELECT r.id FROM requests r JOIN conversations c ON c.id=r.conversation
      LEFT JOIN executions e ON e.id=r.execution WHERE c.owner=? AND r.project=? ORDER BY
      CASE WHEN e.status='active' OR (e.status='unknown' AND EXISTS(SELECT 1 FROM guards g WHERE g.execution=e.id)) THEN 0
      WHEN e.id IS NULL AND COALESCE(r.blocked,'')<>? THEN 1 ELSE 2 END,
      r.rowid DESC LIMIT 10 OFFSET ?`).all(owner, project, OWNER_WITHDRAWN, (page - 1) * 10) as { id: string }[];
    return { total, requests: rows.map(row => this.request(row.id)!) };
  }

  latestTask(owner: string, project: string): RequestRecord | undefined {
    const row = this.db.prepare(`SELECT r.id FROM requests r JOIN conversations c ON c.id=r.conversation
      WHERE c.owner=? AND r.project=? ORDER BY r.rowid DESC LIMIT 1`).get(owner, project) as { id: string } | undefined;
    return row && this.request(row.id);
  }

  ownedTask(execution: string, owner: string, project: string): RequestRecord | undefined {
    const row = this.db.prepare(`SELECT r.id FROM requests r JOIN conversations c ON c.id=r.conversation
      WHERE r.execution=? AND c.owner=? AND r.project=?`).get(execution, owner, project) as { id: string } | undefined;
    return row && this.request(row.id);
  }

  taskOverview(owner: string, project: string) {
    const scope = `FROM requests r JOIN conversations c ON c.id=r.conversation LEFT JOIN executions e ON e.id=r.execution
      LEFT JOIN guards g ON g.execution=e.id WHERE c.owner=? AND r.project=?`;
    const active = "e.status='active'", unknown = "e.status='unknown' AND g.execution IS NOT NULL";
    const unstarted = "e.id IS NULL AND COALESCE(r.blocked,'')<>?";
    const counts = this.db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(${active}),0) active,
      COALESCE(SUM(${unknown}),0) unknown,COALESCE(SUM(${unstarted}),0) unstarted ${scope}`)
      .get(OWNER_WITHDRAWN, owner, project) as { total: number; active: number; unknown: number; unstarted: number };
    const recent = this.db.prepare(`SELECT r.id ${scope} AND NOT (COALESCE(${active},0) OR COALESCE((${unknown}),0) OR (${unstarted})) ORDER BY r.rowid DESC LIMIT 3`)
      .all(owner, project, OWNER_WITHDRAWN) as { id: string }[];
    const current = this.taskPage(owner, project, 1).requests.filter(r => {
      const e = this.execution(r.execution);
      return e?.status === 'active' || (e?.status === 'unknown' && this.unsettled().some(g => g.id === e.id)) || (!e && r.blocked !== OWNER_WITHDRAWN);
    });
    return { counts, current, recent: recent.map(row => this.request(row.id)!) };
  }

  verification(execution: string): VerificationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM verifications WHERE execution=?').get(execution) as
      (Omit<VerificationRecord, 'definition' | 'observation'> & { definition: string; observation: string | null }) | undefined;
    return row && { ...row, definition: JSON.parse(row.definition), observation: row.observation ? JSON.parse(row.observation) : null };
  }

  verificationBinding(execution: string): string | undefined {
    const value = this.verification(execution);
    return value && fingerprint(JSON.stringify(value));
  }

  beginVerification(permit: Permit): void {
    this.transaction(() => {
      this.startableRequest(permit);
      if (!this.db.prepare("UPDATE verifications SET phase='running' WHERE execution=? AND phase='planned'").run(permit.execution).changes) {
        throw new Error('Verification is not launchable');
      }
    });
  }

  finishVerification(permit: Permit, observation?: VerificationObservation): void {
    this.transaction(() => {
      this.validatePermit(permit);
      const phase = observation ? observation.cleanupSettled ? 'observed' : 'unknown' : 'skipped';
      if (!this.db.prepare("UPDATE verifications SET phase=?,observation=? WHERE execution=? AND phase=?")
        .run(phase, observation ? JSON.stringify(observation) : null, permit.execution, observation ? 'running' : 'planned').changes) {
        throw new Error('Verification already dispatched or settled');
      }
    });
  }

  control(message: Pick<IncomingMessage, 'tenant' | 'id'>): ControlRecord | undefined {
    const row = this.db.prepare('SELECT * FROM controls WHERE origin=?').get(JSON.stringify([message.tenant, message.id])) as
      (Omit<ControlRecord, 'message' | 'target'> & { message: string; target: string | null }) | undefined;
    return row && { ...row, message: JSON.parse(row.message), target: row.target ? JSON.parse(row.target) : null };
  }

  acceptControl(execution: string, message: IncomingMessage, target?: NativeControlTarget, repairStop = false): ControlRecord {
    return this.transaction(() => {
      const origin = JSON.stringify([message.tenant, message.id]);
      if (this.db.prepare('SELECT 1 FROM requests WHERE origin=? UNION SELECT 1 FROM recoveries WHERE origin=? UNION SELECT 1 FROM withdrawals WHERE origin=?').get(origin, origin, origin)) throw new Error('Message identity already has another purpose');
      const previous = this.control(message);
      if (previous) return previous;
      if (!this.db.prepare('SELECT 1 FROM guards WHERE execution=?').get(execution)) throw new Error('No current execution for control');
      this.db.prepare("INSERT INTO controls VALUES (?,?,?,?,'received',NULL)").run(origin, execution, JSON.stringify(message), target ? JSON.stringify(target) : null);
      if (repairStop) {
        const row = this.execution(execution), request = row && this.request(row.request);
        if (!request || !this.repairs.get(execution) || message.chatType !== 'p2p' || ownerKey(message) !== ownerKey(request.message)) throw new Error('Invalid repair stop owner');
        this.repairs.stop(execution);
        this.db.prepare("UPDATE controls SET status='stopping',result=? WHERE origin=?")
          .run('已记录停止整个修复任务的请求；不会启动后续轮次，当前执行和清理结果仍需确认。', origin);
      }
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
    this.db.prepare('UPDATE reference_context SET body=NULL WHERE execution=? AND body IS NOT NULL').run(execution);
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
      const quoted = this.db.prepare(`SELECT e.native_thread FROM task_replies q JOIN requests source ON source.id=q.request
        JOIN executions e ON e.id=source.execution WHERE q.followup=?`).get(request.id) as { native_thread: string } | undefined;
      if (quoted && this.conversationThread(request.conversation) !== quoted.native_thread) {
        this.db.prepare('UPDATE requests SET blocked=? WHERE id=?').run(QUOTED_CONVERSATION_CHANGED, request.id);
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

  nativeSnapshot(permit: Permit, snapshot: { thread: string; turn: string | null; generation: string | null }, repairAttempt?: string): void {
    this.transaction(() => {
      const request = this.ownedRequest(permit);
      const prior = this.db.prepare('SELECT native_thread,native_turn,native_generation FROM executions WHERE id=?').get(permit.execution) as
        { native_thread: string | null; native_turn: string | null; native_generation: string | null };
      const goal = this.repairs.get(permit.execution);
      if (goal) {
        const a = goal.attempts.at(-1);
        if (!a || a.id !== repairAttempt) throw new Error('Stale repair attempt snapshot');
        const saved = this.db.prepare('SELECT live_thread,live_turn,live_generation FROM repair_attempts WHERE id=?').get(a.id) as
          { live_thread: string | null; live_turn: string | null; live_generation: string | null };
        if ((prior.native_thread && prior.native_thread !== snapshot.thread) ||
          (saved.live_thread && saved.live_thread !== snapshot.thread) || (saved.live_turn && snapshot.turn && saved.live_turn !== snapshot.turn) ||
          (saved.live_generation && snapshot.generation && saved.live_generation !== snapshot.generation) ||
          (a.native && (a.native.outcome.thread !== snapshot.thread || (snapshot.turn && a.native.outcome.turn !== snapshot.turn) ||
            (snapshot.generation && a.native.outcome.generation !== snapshot.generation)))) throw new Error('Repair native identity changed');
        this.db.prepare('UPDATE repair_attempts SET live_thread=?,live_turn=COALESCE(?,live_turn),live_generation=COALESCE(?,live_generation) WHERE id=?')
          .run(snapshot.thread, snapshot.turn, snapshot.generation, a.id);
        this.db.prepare('UPDATE executions SET native_thread=?,native_turn=?,native_generation=? WHERE id=?')
          .run(snapshot.thread, snapshot.turn ?? saved.live_turn, snapshot.generation ?? saved.live_generation, permit.execution);
      } else {
        if (repairAttempt || (prior.native_thread && prior.native_thread !== snapshot.thread) || (prior.native_turn && snapshot.turn && prior.native_turn !== snapshot.turn) ||
          (prior.native_generation && snapshot.generation && prior.native_generation !== snapshot.generation)) throw new Error('Native execution identity changed');
        this.db.prepare('UPDATE executions SET native_thread=?,native_turn=COALESCE(?,native_turn),native_generation=COALESCE(?,native_generation) WHERE id=?')
          .run(snapshot.thread, snapshot.turn, snapshot.generation, permit.execution);
      }
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
      this.db.prepare("UPDATE verifications SET phase='skipped' WHERE execution=? AND phase='planned'").run(request.execution);
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
      this.db.prepare("UPDATE verifications SET phase='unknown',observation=? WHERE execution=? AND phase IN ('planned','running')")
        .run(JSON.stringify({ status: 'unverified', cleanupSettled: true, code: null, signal: null,
          reason: 'Original verification outcome remains unconfirmed after operator process/effect inspection', observedAt: Date.now() }), execution);
      // Keep the original uncertain outcome. A new request carries any remaining-work authorization.
    });
  }

  close(): void { this.db.close(); }
}
