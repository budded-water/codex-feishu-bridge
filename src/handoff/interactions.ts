import { OwnerMatters } from './matters.js';
import type { MatterClick } from '../matter-card.js';
import { OwnerBrowserAccess, browserAllowIntent } from './browser-access.js';
import { message as present, section, copyBlock } from '../presentation.js';
import type { Config } from '../config.js';
import type { Sender } from '../outbox.js';
import type { ReactionPort } from '../feedback.js';
import { naturalControl } from '../ux.js';
import { ownerKey, type IncomingMessage, type NativeControlTarget, type ContextPort } from '../types.js';
import { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import type { SourceOutbox } from './source.js';
import { HandoffTransport } from './transport.js';
import type { ControlRecord, RequestRecord } from './store.js';
import { FeishuRecovery } from './recovery.js';
import { OwnerQueue } from './queue.js';
import { approvalActorAllowed, type ApprovalClick, type CardResult } from '../approval.js';
import { isMaintenanceOwner } from './owner-access.js';
import { repairText } from './repair-view.js';
import { type VerificationProfiles } from './verification-profile.js';
import { verificationApplicability, verificationText } from './verification-view.js';
import { verificationFindings } from './findings.js';
import { OwnerDeliveries } from './deliveries.js';
import { OwnerTasks } from './tasks.js';
import type { TaskRefreshClick } from '../task-card.js';
import { OwnerPermissions } from './permissions.js';
import type { ReviewClick } from '../review-card.js';
import type { VisualReviewClick } from '../visual-review.js';
import { executeVisualOperation, type VisualOperation, type VisualOperationResult, type VisualWorkflows } from './visual-review-workflow.js';

export class PilotInteractions {
  readonly transport: HandoffTransport;
  private recovery: FeishuRecovery;
  private queue: OwnerQueue;
  private tasks: OwnerTasks;
  private deliveries: OwnerDeliveries;
  private matters: OwnerMatters;
  private permissions: OwnerPermissions;
  private browserAccess: OwnerBrowserAccess;
  private work?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private startup?: Promise<void>;
  private publication?: Promise<void>;
  private controlWork?: Promise<void>;
  private visualWork?: Promise<void>;
  private visualResult?: { operation: VisualOperation; result?: VisualOperationResult };
  private viewWork: Promise<void> = Promise.resolve();

  constructor(readonly admission: PilotAdmission, private config: Config, private source: Pick<SourceOutbox, 'flush' | 'diagnose'>,
    private native: NativeExecutions, sender: Sender, reactions: ReactionPort, secrets: string[] = [], private contextPort?: ContextPort,
    private profiles: VerificationProfiles = {}, private workflows: VisualWorkflows = {}, private assertVisualOwner = () => {}) {
    this.transport = new HandoffTransport(admission, native, sender, reactions, secrets);
    this.recovery = new FeishuRecovery(admission, config, native, source, this.transport.state);
    this.queue = new OwnerQueue(admission, config, this.transport.state);
    this.deliveries = new OwnerDeliveries(admission, config, this.transport.state, native, profiles);
    this.matters = new OwnerMatters(admission, this.transport.state);
    this.tasks = new OwnerTasks(admission, config, native, this.transport.state, profiles);
    this.permissions = new OwnerPermissions(admission, config, native, this.transport.state);
    this.browserAccess = new OwnerBrowserAccess(admission, config, native, this.transport.state);
  }

  receive(message: IncomingMessage) {
    if (this.closing) return { status: 'rejected' as const };
    if (this.admission.store.retained(message)) return { status: 'ignored' as const };
    if (message.unsupported === 'post' && isMaintenanceOwner(this.admission.scope, this.config, message)) {
      this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
          '暂不支持这类消息。请用纯文本交办任务；进度查询可发送 /tasks 或 /task 完整编号，也支持仅包含进度或权限只读查询的文字富文本。', { replyTo: message.id });
      });
      return { status: 'rejected' as const };
    }
    if (/^\/browser-retry(?:\s|$)/.test(message.text.trim()) || browserAllowIntent(message.text)) return this.browserAccess.receive(message);
    if (/^\/(?:matters|matter-new|matter-bind)(?:\s|$)/.test(message.text.trim())) return this.matters.receive(message);
    if (/^\/delivery(?:-wait|-confirm)?(?:\s|$)/.test(message.text.trim())) return this.deliveries.receive(message);
    if (/^\/(?:tasks|task)(?:\s|$)/.test(message.text.trim())) return this.tasks.receive(message);
    if (/^\/(?:rules|reviews|review|review-retry)(?:\s|$)/.test(message.text.trim())) return this.permissions.receive(message);
    if (/^\/findings(?:\s|$)/.test(message.text.trim())) return this.findingsCommand(message);
    if (/^\/(?:verify|verify-repair|verification)(?:\s|$)/.test(message.text.trim())) return this.verificationCommand(message);
    if (/^\/recover(?:\s|$)/.test(message.text.trim())) return this.recovery.receive(message);
    if (/^\/(?:queue|withdraw)(?:\s|$)/.test(message.text.trim())) return this.queue.receive(message);
    const operator = message.tenant === this.admission.scope.tenant && message.user === this.admission.scope.operator && message.chat === this.admission.scope.chat;
    const approval = /^\/(?:approve|approve-save|reject|answer)(?:\s|$)/.test(message.text.trim());
    const admin = approval && message.tenant === this.admission.scope.tenant && this.config.approvalUsers.includes(message.user) &&
      message.chat === (this.config.approvalChat ?? this.admission.scope.chat) &&
      (this.config.accessMode !== 'allowlist' || this.config.allowedUsers.includes(message.user));
    if (!operator && !admin) return { status: 'ignored' as const };
    const ordinaryOwner = operator && message.chatType === 'p2p';
    if (ordinaryOwner) {
      const request = this.admission.store.requestForMessage(message);
      if (request) {
        this.transport.admit(request);
        return { status: 'duplicate' as const, request };
      }
      const control = this.admission.store.control(message);
      if (control) return { status: 'duplicate' as const, control };
      if (this.matters.hasDisposition(message)) return this.matters.route(message);
      if (this.transport.state.hasSeen(message)) return { status: 'duplicate' as const };
    }
    const natural = naturalControl(message.text.trim());
    const command = /^\/(?:help|status|stop|steer|approve|approve-save|reject|answer)(?:\s|$)/.test(message.text.trim());
    if (ordinaryOwner && message.parentId && !message.unsupported &&
      message.text.length <= 30_000 && message.text.trim() && !message.text.trimStart().startsWith('/') && natural !== 'stop') {
      const answer = this.transport.state.confirmedAnswer(message);
      if (answer) {
        if (this.admission.projectAddress(message.text)?.outsidePilot) return this.admission.receive(message);
        const held = this.matters.holdConflictingAnswer(message, answer);
        if (held) return held;
      }
      const visual = answer ? this.transport.state.visualReviews.context(message.parentId) : undefined;
      const reply = this.admission.store.acceptTaskReply(message, this.admission.project, answer, visual);
      if (reply) return reply;
    }
    if (!command && (!natural || (natural === 'steer' && this.matters.overridesNaturalSteer(message)))) {
      const result = this.matters.route(message);
      if ('request' in result) this.transport.admit(result.request);
      if (result.status === 'rejected' && result.reason === 'maintenance') this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat, '系统正在维护，这条新请求没有开始。恢复后请重新发送需求。', { replyTo: message.id });
      });
      if (result.status === 'rejected' && result.reason === 'control_requires_live_gateway') {
        this.transport.state.transaction(() => {
          if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
            this.config.projectRouting === 'workspace' && /^\/project(?:\s|$)/.test(message.text.trim())
              ? '当前为通用工作区。直接说明任务，需要操作仓库时请说明目标目录或项目。'
              : '命令不可用，请发送 /help 查看支持的英文命令。', { replyTo: message.id });
        });
      }
      return result;
    }
    if (message.unsupported || message.text.length > 30_000 || (message.chatType === 'group' && !this.config.enableGroups)) return { status: 'rejected' as const };
    if (message.text.trim() === '/help') {
      if (!this.transport.state.remember(message)) return { status: 'duplicate' as const };
      this.transport.state.send(message.chat,
        present('使用帮助',
          section('交办任务', ['直接发送普通消息；需要操作仓库时说明目标目录或项目。', '在本人私聊回复原任务消息，可补充正在等待或执行的任务，或追问已结束的任务。']),
          section('按事项接续', ['- `/matter-new 事项名称` 新建并切换 · `/matters` 查看及切换', '- 可回复 Bot 的普通最终答案，或用「事项名：任务」、事项卡片、已绑定的 PR 直达', '- `/matter-bind PR链接` 绑定已选中的事项']),
          section('交付等待', ['- `/delivery-wait 普通任务编号 证据引用` 登记 · `/delivery 任务编号` 查看',
            '- `/delivery-wait 验证任务编号` 绑定通过的 Web 报告', '- `/delivery-confirm 任务编号 证据引用`，换行写后续任务']),
          section('查看与控制', ['- `/status` · `/status details` 查看状态', '- `/steer 内容` 补充要求 · `/stop` 停止', '- `/approve 编号` · `/reject 编号` · `/answer 编号 内容` 回应请求']),
          section('本人私聊维护', ['- `/tasks [页码]` 任务列表 · `/task 完整编号` 查看/刷新进度', '- `/rules` 原生规则 · `/reviews` 非通过审查记录', '- `/browser-retry 编号 local-change-confirmed` 本机处理后检查并续接普通任务', '- `/recover [编号 检查依据]` 检查后恢复', '- `/queue` 查看队列 · `/withdraw [完整请求编号]` 撤回', '维护操作还须具备审批角色；撤回仅处理尚未取得执行授权的请求。']),
          Object.keys(this.profiles).length ? section('项目验证', ['- `/verify profile 任务内容` 新建验证任务',
            ...(Object.values(this.profiles).some(p => p.repair) ? ['- `/verify-repair profile 任务内容` 显式允许一轮修复'] : []),
            '- `/verification 任务编号` 查看历史观测', '- `/findings` 汇总待核对验证线索（只读）']) : undefined,
          section('帮助', ['`/help` 查看本说明'])), { replyTo: message.id });
      return { status: 'help' as const };
    }
    const previous = this.admission.store.control(message);
    if (previous) return { status: 'duplicate' as const, control: previous };
    const held = this.admission.store.unsettled();
    const execution = held.length === 1 ? held[0] : undefined;
    let rememberTarget: NativeControlTarget | undefined;
    if (/^\/approve-save(?:\s|$)/.test(message.text.trim())) {
      const token = /^\/approve-save\s+([a-f0-9]{8})(?:\s|$)/.exec(message.text.trim())?.[1];
      rememberTarget = execution && token ? this.transport.state.rememberApprovalTarget(execution.id, token, message) : undefined;
      if (!rememberTarget) {
        this.transport.state.transaction(() => {
          if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
            '当前没有已确认投递且完整展示长期规则的有效审批卡片；没有保存规则。可使用原请求的批准本次或拒绝，或稍后重新核对。', { replyTo: message.id });
        });
        return { status: 'rejected' as const };
      }
    }
    const reference = message.parentId ? this.transport.state.referencedTask(message.parentId, ownerKey(message)) : undefined;
    const repair = execution && this.admission.store.repairs.get(execution.id);
    if (repair && operator && (!message.parentId || reference === execution!.id) &&
      (/^\/status(?:\s|$)/.test(message.text.trim()) || message.text.trim() === '/stop' || natural === 'stop')) {
      if (message.text.trim() === '/stop' || natural === 'stop') {
        const control = this.admission.store.acceptControl(execution!.id, message, undefined, true);
        this.transport.state.projectControlNotice(control);
      } else if (this.transport.state.remember(message)) this.transport.state.send(message.chat, repairText(repair, undefined, execution!.status === 'unknown'), { replyTo: message.id });
      return { status: 'repair-control' as const };
    }
    if (execution && /^\/status(?:\s|$)/.test(message.text.trim())) {
      const verification = this.admission.store.verification(execution.id);
      if (verification?.phase === 'running') {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
          verificationText(verification, { execution: ['Codex 本轮已完成，项目验证正在运行；执行保护保留，`/stop` 可请求中止验证。'] }), { replyTo: message.id });
        return { status: 'verification-status' as const };
      }
    }
    const quotedSupplement = message.parentId && !reference && /^\/steer\s/.test(message.text.trim()) &&
      (!ordinaryOwner || (!this.matters.hasNamedMatters(message) && !this.transport.state.matterReference(message) &&
        !this.transport.state.pendingRefundReference(message)));
    if (!execution || (!approval && message.parentId && reference !== execution.id && !quotedSupplement)) {
      this.transport.state.transaction(() => {
        if (!this.transport.state.remember(message)) return;
        const queued = this.admission.store.requests().filter(request => !request.blocked && !this.admission.store.execution(request.execution) &&
          this.admission.store.submission(request.id)?.status !== 'blocked').length;
        const body = /^\/status(?:\s|$)/.test(message.text.trim()) && !execution
          ? present('当前状态', section('执行', [this.config.projectRouting === 'workspace' ? '当前：通用工作区。' : '当前：项目工作区。', '当前没有运行任务。', ...(queued ? [`还有 ${queued} 个已接收的请求等待派活。`] : [])]), section('结果边界', ['未确认的结果需要先核对，不会自动重跑。']))
          : execution ? '未能确定这条引用对应的运行任务，请引用自己的原提问。' : '当前没有可控制的运行任务。已接收的排队请求会保留；未确认的结果需要先核对。';
        this.transport.state.send(message.chat, body, { replyTo: message.id });
      });
      return { status: 'rejected' as const };
    }
    if (execution.status === 'unknown' && /^\/status(?:\s|$)/.test(message.text.trim())) {
      const verification = this.admission.store.verification(execution.id);
      this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
          verification ? verificationText(verification, { execution: ['原生/验证执行保护仍保留；阶段记录不证明进程在线。请本机检查进程与副作用后登记恢复，不会重跑。'] })
            : '原任务结果未确认，执行保护仍保留。本人可在登记私聊发送 /recover 查看检查条件；不会自动重跑。', { replyTo: message.id });
      });
      return { status: 'rejected' as const };
    }
    const control = this.admission.store.acceptControl(execution.id, message, rememberTarget);
    if (message.text.trim() === '/stop' || natural === 'stop') void this.relay(control).catch(() => console.error('Stop relay unavailable; retained dispatch will be inspected'));
    void this.flushControls().catch(() => console.error('Control relay unavailable; retained dispatch will be inspected'));
    return { status: 'control' as const, control };
  }

  private findingsCommand(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message) || message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    this.viewWork = this.viewWork.then(async () => {
      const body = message.text.trim() === '/findings'
        ? await verificationFindings(this.admission, this.native, message, this.profiles)
        : '请发送 /findings 查看本人当前工作区的验证线索；查询不会执行任务。';
      this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat, body, { replyTo: message.id });
      });
    }).catch(() => {
      try {
        this.transport.state.transaction(() => {
          if (this.transport.state.remember(message)) this.transport.state.send(message.chat, '验证线索暂时无法读取，没有启动任务。请稍后发送新的 /findings。', { replyTo: message.id });
        });
      } catch { console.error('Findings answer could not be retained; query receipt rolled back'); }
    });
    return { status: 'findings-view' as const };
  }

  private verificationCommand(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message) || message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    const text = message.text.trim();
    const repair = /^\/verify-repair(?:\s|$)/.test(text);
    const selected = /^\/(?:verify|verify-repair)\s+([a-zA-Z0-9_-]{1,64})\s+([\s\S]+)$/.exec(message.text.trimStart());
    if (selected && selected[2]!.trim() && Object.hasOwn(this.profiles, selected[1]!)) {
      const definition = this.profiles[selected[1]!]!;
      if (repair && !definition.repair) {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat, '该 profile 未登记有界修复策略。可使用 /verify 执行单轮任务与验证。', { replyTo: message.id });
        return { status: 'rejected' as const };
      }
      const result = this.admission.receiveVerification(message,
        `本任务选择的项目验证目标为 ${definition.projectRoot}。仅在该项目处理以下需求；完成后系统会运行已登记验证，无需自行重复调用验证器。\n\n${selected[2]!}`,
        { profile: selected[1]!, definition, ...(repair ? { repair: true as const } : {}) });
      if ('request' in result) {
        this.transport.admit(result.request);
        if (result.status !== 'duplicate' && this.transport.state.remember(message)) this.transport.state.send(message.chat,
          present(`已保存验证任务 · ${selected[1]}`,
            result.status === 'blocked' ? '前序结果未确认，本次未开始且不会自动执行；请先核对。' : repair ? '已显式选择有界修复：符合登记条件的功能断言失败后，最多追加一轮 Codex 修复和一次完整验证。' : 'Codex 完成本轮后执行已登记验证。',
            section('查看进度与结果', [copyBlock(`/verification ${result.request.execution}`)])), { replyTo: message.id });
        return result;
      }
      if (result.reason === 'maintenance' && this.transport.state.remember(message)) this.transport.state.send(message.chat,
        '系统正在维护，这条验证任务没有开始。恢复后请发送新消息。', { replyTo: message.id });
      return result;
    }
    if (!this.transport.state.remember(message)) return { status: 'duplicate' as const };
    const query = /^\/verification\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(text);
    const request = query && this.admission.store.requests().find(row => row.execution === query[1]!.toLowerCase() && ownerKey(row.message) === ownerKey(message));
    const goal = request && this.admission.store.repairs.get(request.execution);
    if (goal) {
      this.viewWork = this.viewWork.then(async () => {
        const last = goal.attempts.at(-1);
        const applicability = last?.observation ? await verificationApplicability({ execution: goal.execution, profile: goal.profile,
          digest: goal.digest, definition: goal.definition, phase: 'observed', observation: last.observation }, this.profiles) : '暂无可核实的验证观测。';
        this.transport.state.send(message.chat, repairText(goal, applicability, this.admission.store.execution(goal.execution)?.status === 'unknown'), { replyTo: message.id });
      }).catch(() => { this.transport.state.send(message.chat, '修复记录暂时无法核实，不会重新执行。', { replyTo: message.id }); });
      return { status: 'verification-view' as const };
    }
    const value = request && this.admission.store.verification(request.execution);
    if (value) {
      this.viewWork = this.viewWork.then(async () => {
        const applicability = await verificationApplicability(value, this.profiles);
        const unknown = this.admission.store.execution(value.execution)?.status === 'unknown' && ['planned', 'running'].includes(value.phase);
        const guarded = this.admission.store.unsettled().some(row => row.id === value.execution);
        this.transport.state.send(message.chat, verificationText(value, {
          execution: [...(unknown ? ['执行器已无法确认；上述阶段是保留记录，不代表进程仍在线。'] : []),
            guarded ? '当前执行保护仍保留。' : '当前该任务无执行保护；历史结果保持原记录。'], applicability,
        }), { replyTo: message.id });
      }).catch(() => { this.transport.state.send(message.chat, '验证观测暂时无法核实，不会重新执行。', { replyTo: message.id }); });
    } else this.transport.state.send(message.chat,
      '未启动验证。请用 /verify profile 任务内容，或 /verification 完整任务编号查看自己的观测。可用 profile：' + (Object.keys(this.profiles).join('、') || '未配置'), { replyTo: message.id });
    return { status: 'verification-view' as const };
  }

  private dispatchMessage(control: ControlRecord): IncomingMessage {
    if (control.message.text.trim().startsWith('/')) return control.message;
    const intent = naturalControl(control.message.text.trim());
    return { ...control.message, text: intent === 'stop' ? '/stop' : '/steer ' + control.message.text };
  }

  cardAction(click: ApprovalClick): CardResult {
    if (this.closing || click.tenant !== this.admission.scope.tenant || !approvalActorAllowed(this.config, click)) return 'rejected';
    const selected = this.transport.state.approvalClick(click);
    if (!selected || !this.admission.store.unsettled().some(row => row.id === selected.task && row.status === 'active')) return 'rejected';
    const previous = this.admission.store.control(selected.message);
    if (previous) return 'duplicate';
    this.admission.store.acceptControl(selected.task, selected.message, selected.target);
    void this.flushControls().catch(() => console.error('Card decision outcome awaits lookup'));
    return 'accepted';
  }

  matterAction(click: MatterClick): CardResult {
    if (this.closing) return 'rejected';
    const result = this.matters.click(click);
    if (result.flush) void this.flush().catch(() => console.error('Matter decision is retained; publication awaits retry'));
    return result.status;
  }

  taskRefresh(click: TaskRefreshClick): CardResult { return this.closing ? 'rejected' : this.tasks.refresh(click); }
  reviewAction(click: ReviewClick): CardResult { return this.closing ? 'rejected' : this.permissions.click(click); }

  private async relay(control: ControlRecord): Promise<void> {
    const message = this.dispatchMessage(control);
    const taskReply = this.admission.store.taskReply(control.origin);
    const rejection = taskReply ? undefined : '原任务或请求已结束、过期或无权控制，这条指令没有执行。';
    if (control.status !== 'received') {
      try {
        const status = await this.native.controlResult(control.execution, message);
        if (status && status !== 'dispatching') this.admission.store.controlResult(control.message, status, status === 'rejected' ? rejection : undefined);
      } catch { /* Uncertain dispatch is lookup-only; approvals are never resent. */ }
      return;
    }
    if (taskReply && this.admission.store.execution(control.execution)?.status !== 'active') return;
    if (message.chatType === 'group' && message.parentId && /^\/steer\s/.test(message.text.trimStart())) {
      const execution = this.admission.store.execution(control.execution)!;
      await this.prepareReference(this.admission.store.request(execution.request)!, message, 0);
    }
    let target = control.target;
    if (!target) {
      try {
        const owner = await this.native.inspect(control.execution);
        if (taskReply && owner.status !== 'running') return;
        const fields = { generation: owner.generation, thread: owner.thread, turn: owner.turn };
        if (Object.values(fields).some(value => typeof value !== 'string' || !value)) return;
        target = fields as NativeControlTarget;
        this.admission.store.bindControl(control.message, target);
      } catch {
        // A new Worker may not have started. Polling settles quoted controls against the exact execution.
        if (taskReply) return;
        this.admission.store.controlResult(control.message, 'rejected', '原执行器当前不可确认，这条控制没有执行。请先核对状态。');
        return;
      }
    }
    if (!this.admission.store.dispatchControl(control.message)) return;
    try {
      const result = await this.native.relay(control.execution, message, target);
      this.admission.store.controlResult(control.message, result, result === 'rejected' ? rejection : undefined);
    } catch {
      this.admission.store.controlResult(control.message, 'unknown', '这条控制是否生效尚未确认，正在核对执行记录；不会自动重发。');
    }
  }

  private async prepareReference(request: RequestRecord, message: IncomingMessage, limit: number): Promise<void> {
    const execution = request.execution;
    if (this.admission.store.reference(execution, message)) return;
    const session = { id: request.conversation, owner: ownerKey(request.message), tenant: request.message.tenant,
      user: request.message.user, chat: request.message.chat, project: this.admission.scope.pilot, directory: this.admission.directory,
      thread: this.admission.store.conversationThread(request.conversation) };
    const { id, chatType, createTime, parentId } = message;
    const context = (limit || parentId) && this.contextPort
      ? await this.contextPort.context(session, { id, chatType, createTime, parentId }, limit)
      : { status: 'unavailable' as const, messages: [], note: '尚未启用群聊前文读取；请引用或粘贴要讨论的内容。' };
    this.admission.store.saveReference(execution, message, context);
  }

  private async publish(): Promise<void> {
    for (const request of this.admission.store.unpreparedGroupReferences()) {
      await this.prepareReference(request, request.message, this.config.groupContextMessages);
    }
    await this.source.flush();
  }

  private flushControls(): Promise<void> {
    if (this.controlWork) return this.controlWork;
    this.controlWork = (async () => {
      const visited = new Set<string>();
      for (;;) {
        const batch = this.admission.store.pendingControls().filter(control => !visited.has(control.origin));
        if (!batch.length) break;
        for (const control of batch) { visited.add(control.origin); await this.relay(control); }
      }
    })().finally(() => { this.controlWork = undefined; });
    return this.controlWork;
  }

  flush(): Promise<void> {
    if (this.closing) return Promise.resolve();
    if (this.work) return this.work;
    this.work = this.synchronize().finally(() => { this.work = undefined; });
    return this.work;
  }

  visualReviewAction(click: VisualReviewClick): CardResult {
    if (this.closing || this.admission.store.maintenance.paused ||
      !isMaintenanceOwner(this.admission.scope, this.config, { ...click, chatType: 'p2p', text: '' })) return 'rejected';
    if (click.decision !== 'accept' && this.admission.store.unsettled().some(execution => execution.status === 'unknown')) return 'rejected';
    this.assertVisualOwner();
    const state = this.transport.state;
    const result = state.transaction(() => state.visualReviews.decide(click));
    if (result === 'accepted') void this.flush().catch(() => console.error('Visual decision is retained'));
    return result;
  }

  private launchVisualReview(): void {
    if (this.visualWork || this.closing || !this.persistVisualResult()) return;
    if (this.admission.store.unsettled().some(execution => execution.status === 'unknown')) return;
    this.assertVisualOwner();
    const state = this.transport.state;
    const operation = state.transaction(() => state.visualReviews.take());
    if (!operation) return;
    this.visualWork = (async () => {
      let result: VisualOperationResult | undefined;
      try {
        result = isMaintenanceOwner(this.admission.scope, this.config, { ...operation.owner, chatType: 'p2p', id: operation.id, text: '' })
          ? await executeVisualOperation(operation, this.workflows)
          : { status: 'blocked', reason: 'authorization' };
      } catch { console.error('Visual review workflow result requires inspection'); }
      this.visualResult = { operation, result };
      this.persistVisualResult();
    })().finally(() => { this.visualWork = undefined; });
  }

  private persistVisualResult(): boolean {
    if (!this.visualResult) return true;
    try {
      this.assertVisualOwner();
      this.transport.state.visualReviews.finish(this.visualResult.operation, this.visualResult.result);
      this.visualResult = undefined;
      return true;
    } catch {
      console.error('Visual workflow outcome awaits ledger retry');
      return false;
    }
  }

  private async synchronize(): Promise<void> {
    await this.viewWork;
    await this.deliveries.idle();
    await this.tasks.idle();
    await this.permissions.idle();
    await this.browserAccess.idle();
    await this.recovery.idle();
    this.recovery.sync();
    this.queue.sync();
    this.matters.sync();
    this.launchVisualReview();
    if (!this.publication) this.publication = this.publish()
      .catch(() => console.error('Source publication unavailable; retained intent will be retried'))
      .finally(() => { this.publication = undefined; });
    await this.native.poll();
    await this.permissions.publish();
    await this.transport.sync();
    await this.flushControls();
    this.admission.store.finishTaskReplies();
    await this.transport.sync();
    for (const control of this.admission.store.controls()) this.transport.state.projectControlNotice(control);
    await this.transport.flush();
  }

  async recover(): Promise<void> {
    this.transport.state.visualReviews.recoverLaunches();
    await this.native.recover();
    this.matters.sync();
    this.admission.store.finishTaskReplies();
    await this.transport.sync();
  }

  start(): Promise<void> {
    if (this.startup || this.closing) throw new Error('Pilot interactions already running or closed');
    return this.startup = (async () => {
      await this.recover();
      if (this.closing) return;
      this.timer = setInterval(() => { void this.flush().catch(() => console.error('Pilot synchronization unavailable; retained records will be inspected again')); }, 1000);
    })();
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      clearInterval(this.timer);
      await this.startup?.catch(() => {});
      await this.work;
      await this.publication;
      await this.controlWork;
      await this.visualWork;
      this.persistVisualResult();
      await this.viewWork;
      await this.deliveries.idle();
      await this.tasks.idle();
      await this.permissions.idle();
      await this.browserAccess.idle();
      await this.recovery.idle();
      this.recovery.sync();
      this.queue.sync();
      this.admission.store.finishTaskReplies();
      await this.transport.close();
    })();
  }
}
