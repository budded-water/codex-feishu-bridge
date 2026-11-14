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

export class PilotInteractions {
  readonly transport: HandoffTransport;
  private recovery: FeishuRecovery;
  private work?: Promise<void>;
  private timer?: NodeJS.Timeout;
  private closing?: Promise<void>;
  private startup?: Promise<void>;
  private publication?: Promise<void>;
  private controlWork?: Promise<void>;

  constructor(readonly admission: PilotAdmission, private config: Config, private source: Pick<SourceOutbox, 'flush'>,
    private native: NativeExecutions, sender: Sender, reactions: ReactionPort, secrets: string[] = [], private contextPort?: ContextPort) {
    this.transport = new HandoffTransport(admission, native, sender, reactions, secrets);
    this.recovery = new FeishuRecovery(admission, config, native, this.transport.state);
  }

  receive(message: IncomingMessage) {
    if (this.closing) return { status: 'rejected' as const };
    if (this.admission.store.retained(message)) return { status: 'ignored' as const };
    if (/^\/恢复(?:\s|$)/.test(message.text.trim())) return this.recovery.receive(message);
    const operator = message.tenant === this.admission.scope.tenant && message.user === this.admission.scope.operator && message.chat === this.admission.scope.chat;
    const approval = /^\/(?:批准|拒绝|回答)(?:\s|$)/.test(message.text.trim());
    const admin = approval && message.tenant === this.admission.scope.tenant && this.config.approvalUsers.includes(message.user) &&
      message.chat === (this.config.approvalChat ?? this.admission.scope.chat) &&
      (this.config.accessMode !== 'allowlist' || this.config.allowedUsers.includes(message.user));
    if (!operator && !admin) return { status: 'ignored' as const };
    const natural = naturalControl(message.text.trim());
    const command = /^\/(?:status|stop|补充|批准|拒绝|回答)(?:\s|$)/.test(message.text.trim());
    if (!command && !natural) {
      const result = this.admission.receive(message);
      if ('request' in result) this.transport.admit(result.request);
      if (result.status === 'rejected' && result.reason === 'maintenance') this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat, '系统正在维护，这条新请求没有开始。恢复后请重新发送需求。', { replyTo: message.id });
      });
      if (result.status === 'rejected' && result.reason === 'control_requires_live_gateway' && this.config.projectRouting === 'workspace' && /^\/project(?:\s|$)/.test(message.text.trim())) {
        this.transport.state.transaction(() => {
          if (this.transport.state.remember(message)) this.transport.state.send(message.chat, '当前为通用工作区。直接说明任务，需要操作仓库时请说明目标目录或项目。', { replyTo: message.id });
        });
      }
      return result;
    }
    if (message.unsupported || message.text.length > 30_000 || (message.chatType === 'group' && !this.config.enableGroups)) return { status: 'rejected' as const };
    const previous = this.admission.store.control(message);
    if (previous) return { status: 'duplicate' as const, control: previous };
    const held = this.admission.store.unsettled();
    const execution = held.length === 1 ? held[0] : undefined;
    const reference = message.parentId ? this.transport.state.referencedTask(message.parentId, ownerKey(message)) : undefined;
    const quotedSupplement = /^\/补充\s/.test(message.text.trim()) && !reference;
    if (!execution || (!approval && message.parentId && reference !== execution.id && !quotedSupplement)) {
      this.transport.state.transaction(() => {
        if (!this.transport.state.remember(message)) return;
        const queued = this.admission.store.requests().filter(request => !request.blocked && !this.admission.store.execution(request.execution) &&
          this.admission.store.submission(request.id)?.status !== 'blocked').length;
        const body = /^\/status(?:\s|$)/.test(message.text.trim()) && !execution
          ? `${this.config.projectRouting === 'workspace' ? '当前：通用工作区。\n' : ''}当前没有运行任务。${queued ? `还有 ${queued} 个已接收的请求等待派活。` : ''}未确认的结果需要先核对，不会自动重跑。`
          : execution ? '未能确定这条引用对应的运行任务，请引用自己的原提问。' : '当前没有可控制的运行任务。已接收的排队请求会保留；未确认的结果需要先核对。';
        this.transport.state.send(message.chat, body, { replyTo: message.id });
      });
      return { status: 'rejected' as const };
    }
    if (execution.status === 'unknown' && /^\/status(?:\s|$)/.test(message.text.trim())) {
      this.transport.state.transaction(() => {
        if (this.transport.state.remember(message)) this.transport.state.send(message.chat,
          '原任务结果未确认，执行保护仍保留。本人可在登记私聊发送 /恢复 查看检查条件；不会自动重跑。', { replyTo: message.id });
      });
      return { status: 'rejected' as const };
    }
    const control = this.admission.store.acceptControl(execution.id, message);
    if (message.text.trim() === '/stop' || natural === 'stop') void this.relay(control).catch(() => console.error('Stop relay unavailable; retained dispatch will be inspected'));
    void this.flushControls().catch(() => console.error('Control relay unavailable; retained dispatch will be inspected'));
    return { status: 'control' as const, control };
  }

  private dispatchMessage(control: ControlRecord): IncomingMessage {
    if (control.message.text.trim().startsWith('/')) return control.message;
    const intent = naturalControl(control.message.text.trim());
    return { ...control.message, text: intent === 'stop' ? '/stop' : '/补充 ' + control.message.text };
  }

  private async relay(control: ControlRecord): Promise<void> {
    const message = this.dispatchMessage(control);
    if (control.status !== 'received') {
      try {
        const status = await this.native.controlResult(control.execution, message);
        if (status && status !== 'dispatching') this.admission.store.controlResult(control.message, status, status === 'rejected' ? '原任务或请求已结束、过期或无权控制，这条指令没有执行。' : undefined);
      } catch { /* Uncertain dispatch is lookup-only; approvals are never resent. */ }
      return;
    }
    if (message.chatType === 'group' && message.parentId && /^\/补充\s/.test(message.text.trimStart())) {
      const execution = this.admission.store.execution(control.execution)!;
      await this.prepareReference(this.admission.store.request(execution.request)!, message, 0);
    }
    let target = control.target;
    if (!target) {
      try {
        const owner = await this.native.inspect(control.execution);
        const fields = { generation: owner.generation, thread: owner.thread, turn: owner.turn };
        if (Object.values(fields).some(value => typeof value !== 'string' || !value)) return;
        target = fields as NativeControlTarget;
        this.admission.store.bindControl(control.message, target);
      } catch {
        this.admission.store.controlResult(control.message, 'rejected', '原执行器当前不可确认，这条控制没有执行。请先核对状态。');
        return;
      }
    }
    if (!this.admission.store.dispatchControl(control.message)) return;
    try {
      const result = await this.native.relay(control.execution, message, target);
      this.admission.store.controlResult(control.message, result, result === 'rejected' ? '原任务或请求已结束、过期或无权控制，这条指令没有执行。' : undefined);
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
    for (const request of this.admission.store.requests()) {
      if (!request.blocked && !this.admission.store.execution(request.execution) && request.message.chatType === 'group') {
        await this.prepareReference(request, request.message, this.config.groupContextMessages);
      }
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

  private async synchronize(): Promise<void> {
    await this.recovery.idle();
    this.recovery.sync();
    if (!this.publication) this.publication = this.publish()
      .catch(() => console.error('Source publication unavailable; retained intent will be retried'))
      .finally(() => { this.publication = undefined; });
    await this.native.poll();
    await this.transport.sync();
    await this.flushControls();
    await this.transport.sync();
    for (const control of this.admission.store.controls()) this.transport.state.projectControlNotice(control);
    await this.transport.flush();
  }

  async recover(): Promise<void> {
    await this.native.recover();
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
      await this.recovery.idle();
      await this.transport.close();
    })();
  }
}
