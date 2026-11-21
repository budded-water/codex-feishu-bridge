import { removeMaterializedAttachment } from './attachments.js';
import { browserAccessText, browserRetryCommand } from '../browser-access.js';
import { section, copyBlock, taskReceipt } from '../presentation.js';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { isMaintenanceOwner } from './owner-access.js';
import type { DatabaseSync } from 'node:sqlite';
import { State } from '../state.js';
import { Outbox, type Sender } from '../outbox.js';
import { Feedback, type ReactionPort } from '../feedback.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { OWNER_WITHDRAWN, QUOTED_CONVERSATION_CHANGED, type RequestRecord } from './store.js';
import { verificationText } from './verification-view.js';
import { repairText } from './repair-view.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import { DEFAULT_MATTER_TITLE } from './matter-store.js';
import { pendingAttachmentRetirements, openHandoffReader, unprojectedAttachmentReceipts, unprojectedTaskReplyNotices } from './read-only.js';

const projectedStatus = `CASE WHEN r.blocked=? THEN 'interrupted'
  WHEN r.blocked IS NOT NULL OR s.status='blocked' THEN 'unknown'
  WHEN e.status='active' THEN 'running' ELSE COALESCE(e.status,'queued') END`;

// Transport projections use State's delivery contracts, never its execution queue.
export class HandoffTransport {
  readonly state: State;
  private outbox: Outbox;
  private feedback: Feedback;
  private reader?: DatabaseSync;

  constructor(private gateway: PilotAdmission, private config: Config, private native: NativeExecutions,
    sender: Sender, reactions: ReactionPort, secrets: string[] = []) {
    this.state = new State(join(gateway.stateDirectory, 'transport'), secrets);
    this.outbox = new Outbox(this.state, sender, secrets, async delivery => {
      const source = this.state.projectedDelivery(delivery.id);
      if (!source || !source.live) return true;
      try { return await native.deliveryReady(source.execution, delivery.id); }
      catch { return false; }
    });
    this.feedback = new Feedback(this.state, reactions);
  }

  admit(request: RequestRecord): void {
    const store = this.gateway.store;
    const execution = store.execution(request.execution);
    const withdrawn = request.blocked === OWNER_WITHDRAWN;
    const unscheduled = store.submission(request.id)?.status === 'blocked';
    const matter = !request.blocked && !unscheduled ? this.matterLabel(request) : undefined;
    const reply = matter ? store.taskReply(JSON.stringify([request.message.tenant, request.message.id])) : undefined;
    const routing = !matter ? undefined : store.matters.openedWith(request.message, request.conversation) ? 'opened'
      : store.conversationThread(request.conversation) ? 'continued' : 'accepted';
    this.state.projectAssignedTask(request, this.gateway.scope.pilot, this.gateway.directory,
      withdrawn ? 'interrupted' : request.blocked || unscheduled ? 'unknown' : execution?.status === 'active' ? 'running' : execution?.status ?? 'queued',
      matter && routing ? { matter, followup: reply?.followup === request.id, routing,
        showProgress: isMaintenanceOwner(this.gateway.scope, this.config, request.message) } : undefined);
    if (request.blocked === QUOTED_CONVERSATION_CHANGED) this.state.projectAdmissionNotice(request, '原任务的会话在等待期间发生变化，追问未启动。请重新说明需要处理的事项。');
    else if (unscheduled && !withdrawn) this.state.projectAdmissionNotice(request, '请求已保存，但没有进入预期的调度规则，当前没有开始执行。请部署者检查路由配置；不会换一个编号自动重发。');
  }

  private ownerPrivate(message: IncomingMessage): boolean {
    const scope = this.gateway.scope;
    return message.chatType === 'p2p' && message.tenant === scope.tenant && message.user === scope.operator && message.chat === scope.chat;
  }

  private matterLabel(request: RequestRecord): string | undefined {
    const store = this.gateway.store;
    if (!this.ownerPrivate(request.message) || store.hasDedicatedContinuation(request.execution)) return;
    const owner = { owner: ownerKey(request.message), project: request.project };
    return store.matters.owned(owner, request.conversation)?.title ??
      (store.matters.list(owner, 1).length ? DEFAULT_MATTER_TITLE : undefined);
  }

  private openReader(): DatabaseSync {
    const directory = this.gateway.stateDirectory;
    return this.reader ??= openHandoffReader(join(directory, 'handoff.db'), join(directory, 'transport', 'bridge.db'));
  }

  projectAttachmentReceipt(message: IncomingMessage): void {
    if (!this.ownerPrivate(message)) return;
    this.state.transaction(() => {
      if (this.state.remember(message)) this.state.send(message.chat,
        '已登记文件。请用飞书「回复」这条文件消息，写清希望我怎么处理。', { replyTo: message.id });
    });
  }

  private syncAttachments(reader: DatabaseSync): void {
    for (const message of unprojectedAttachmentReceipts(reader)) this.projectAttachmentReceipt(message);
    for (const { id } of pendingAttachmentRetirements(reader)) this.retireReferences(this.gateway.store.request(id)!);
  }

  private syncTaskReplies(): void {
    for (const { id, kind } of unprojectedTaskReplyNotices(this.openReader())) {
      if (kind === 'thread-change') this.admit(this.gateway.store.request(id)!);
      else {
        const reply = this.gateway.store.taskReply(id)!;
        const next = reply.followup ? this.gateway.store.request(reply.followup) : undefined;
        const matter = next && this.matterLabel(next);
        const result = matter && reply.result
          ? reply.kind === 'followup' && next && !this.gateway.store.deliveryForContinuation(next.id)
            ? taskReceipt('continued', this.state.redact(matter),
              isMaintenanceOwner(this.gateway.scope, this.config, next.message) ? next.execution : undefined)
            : reply.result + '\n事项 · ' + matter
          : reply.result;
        this.state.projectControlNotice({ ...reply, result, origin: 'task-reply/' + id, status: reply.kind });
      }
    }
  }

  async sync(): Promise<void> {
    this.syncTaskReplies();
    const reader = this.openReader();
    // The transport checkpoint and reference tombstones survive restarts independently.
    this.syncAttachments(reader);
    const candidates = reader.prepare(`SELECT r.id FROM requests r
      LEFT JOIN submissions s ON s.request=r.id
      LEFT JOIN executions e ON e.id=r.execution
      LEFT JOIN transport.projected_tasks p ON p.execution=r.execution
      LEFT JOIN transport.tasks t ON t.id=r.execution
      WHERE p.execution IS NULL OR t.status IS NOT ${projectedStatus}
        OR (s.status='blocked' AND r.blocked IS NOT ? AND p.notified=0)
        OR (e.id IS NOT NULL AND p.checkpoint IS NULL)
        OR ((e.status IN ('completed','interrupted') OR (e.id IS NULL AND (r.blocked IS NOT NULL OR s.status='blocked'))) AND EXISTS(
          SELECT 1 FROM reference_context ref WHERE ref.execution=r.execution AND ref.body IS NOT NULL))
      ORDER BY r.rowid`).all(OWNER_WITHDRAWN, OWNER_WITHDRAWN) as { id: string }[];
    for (const { id } of candidates) {
      const request = this.gateway.store.request(id)!;
      this.admit(request);
      const execution = this.gateway.store.execution(request.execution);
      if (!execution) {
        if (request.blocked || this.gateway.store.submission(request.id)?.status === 'blocked') this.retireReferences(request);
        continue;
      }
      if (this.state.projectedFinal(request.execution)) {
        if (['completed', 'interrupted'].includes(execution.status)) this.retireReferences(request);
        continue;
      }
      try {
        const projection = await this.native.projection(request.execution);
        this.state.projectAssignedTask(request, this.gateway.scope.pilot, this.gateway.directory,
          projection.sealed ? String(projection.outcome.status) : this.gateway.store.execution(request.execution)!.status === 'unknown' ? 'unknown' : 'running');
        const verification = projection.sealed && this.gateway.store.verification(request.execution);
        const repair = projection.sealed && this.gateway.store.repairs.get(request.execution);
        const ownerAnswer = projection.sealed && this.ownerPrivate(request.message);
        const blocks = ownerAnswer ? projection.accessBlocks : undefined;
        const browserNotice = blocks?.length ? browserAccessText(blocks) + '\n\n' + section('后续', [
          '核对本机站点设置与原任务副作用后，可明确请求检查并续接；回执不会证明权限或交付成功。',
          copyBlock('/task ' + request.execution),
          ...(!repair && !verification && String(projection.outcome.status) === 'completed' ? [copyBlock(browserRetryCommand(request.execution))] : []),
        ]) : undefined;
        const ordinaryAnswer = ownerAnswer && projection.outcome.status === 'completed' &&
          !this.gateway.store.hasDedicatedContinuation(request.execution);
        let admissionNotice: string | undefined;
        if (projection.sealed && !projection.task) {
          const delivery = this.gateway.store.deliveryForContinuation(request.id);
          const verified = delivery && this.gateway.store.verification(delivery.execution);
          admissionNotice = verified
            ? '续接在启动前已结束。请检查证据的当前适用性和执行状态。\n' + copyBlock('/delivery ' + delivery.execution)
            : '任务在开始执行前已取消，没有启动模型任务。';
        }
        this.state.projectNativeMessages(request, projection, repair ? repairText(repair) : verification ? verificationText(verification) : undefined,
          browserNotice, ordinaryAnswer, admissionNotice);
        if (projection.sealed && ['completed', 'interrupted'].includes(String(projection.outcome.status))) this.retireReferences(request);
      } catch {
        if (this.gateway.store.execution(request.execution)?.status === 'unknown') this.state.projectAdmissionNotice(request, '本机执行器当前无法核实，任务结果尚未确认。请先检查实际结果；不会自动重跑。');
        // Missing ownership cannot authorize prompt delivery or fabricate a final answer.
      }
    }
  }

  private retireReferences(request: RequestRecord): void {
    if (request.message.attachment) {
      try { removeMaterializedAttachment(this.gateway.stateDirectory, request.execution); }
      catch { return; } // Keep the reference in the synchronization query until cleanup succeeds.
    }
    this.gateway.store.retireReferences(request.execution);
  }

  async flush(): Promise<void> {
    void this.outbox.flushVisual().catch(() => console.error('Visual receipt transport unavailable'));
    await Promise.all([this.outbox.flush(), this.feedback.flush()]);
  }
  async close(): Promise<void> {
    try {
      this.syncAttachments(this.openReader());
      this.syncTaskReplies();
    }
    finally {
      await this.outbox.close(); await this.feedback.close();
      this.reader?.close();
      this.state.close();
    }
  }
}
