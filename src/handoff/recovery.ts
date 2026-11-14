import type { Config } from '../config.js';
import type { State } from '../state.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import type { RecoveryRecord } from './store.js';
import type { SourceOutbox } from './source.js';
import { incidentReport } from './diagnostics.js';
import { isMaintenanceOwner } from './owner-access.js';

const usage = '请先核对原命令及其后代进程均已停止，并检查文件和外部副作用。确认后发送 /恢复 编号 检查依据。无法核实时请使用本机维护检查。';

export function recoveryNoticeTarget(admission: PilotAdmission, recovery: RecoveryRecord): Pick<IncomingMessage, 'chat' | 'id'> | undefined {
  const execution = admission.store.execution(recovery.execution);
  const request = execution && admission.store.request(execution.request);
  if (!request || recovery.actor !== ownerKey(request.message) || request.message.tenant !== admission.scope.tenant ||
    request.message.user !== admission.scope.operator || request.message.chat !== admission.scope.chat || request.message.chatType !== 'p2p') return;
  const origin = JSON.parse(recovery.origin) as unknown;
  if (!Array.isArray(origin) || origin.length !== 2 || origin[0] !== request.message.tenant || typeof origin[1] !== 'string') return;
  return { chat: request.message.chat, id: origin[1] };
}

export class FeishuRecovery {
  private work: Promise<void> = Promise.resolve();

  constructor(private admission: PilotAdmission, private config: Config, private native: NativeExecutions, private source: Pick<SourceOutbox, 'diagnose'>, private state: State) {}

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message)) return { status: 'ignored' as const };
    if (message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    if (!this.state.remember(message)) return { status: 'duplicate' as const };
    this.work = this.work.then(() => this.handle(message)).catch(() => {
      if (!this.admission.store.recoveries().some(row => row.origin === JSON.stringify([message.tenant, message.id]))) {
        this.state.send(message.chat, '恢复条件尚未满足，未解除保护。请重新查看 /恢复；仍无法核实时需要本机维护检查。', { replyTo: message.id });
      }
    });
    return { status: 'recovery' as const };
  }

  private held(message: IncomingMessage, execution: string) {
    const held = this.admission.store.unsettled().find(row => row.id === execution && row.status === 'unknown' && row.project === this.admission.project);
    const request = held && this.admission.store.request(held.request);
    return request && ownerKey(request.message) === ownerKey(message) && request.message.chatType === 'p2p' ? held : undefined;
  }

  private async handle(message: IncomingMessage): Promise<void> {
    const text = message.text.trim();
    if (text === '/恢复') {
      const incidents = this.admission.store.unsettled().filter(row => this.held(message, row.id));
      const lines: string[] = [];
      for (const incident of incidents) {
        lines.push(await incidentReport(this.admission, this.native, this.source, this.state, incident));
      }
      const backlog = Number(this.admission.store.drainStatus().queued);
      this.state.send(message.chat, incidents.length ? lines.join('\n\n') + '\n\n' +
        (backlog ? '仍有已接收的未执行任务，需要先通过本机维护核对队列。\n' : '') + usage : '当前没有属于本私聊的待恢复任务。', { replyTo: message.id });
      return;
    }
    const command = /^\/恢复\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+([\s\S]+)$/i.exec(text);
    if (!command || command[2]!.trim().length > 1800) {
      this.state.send(message.chat, usage + ' 检查依据最长 1800 字符。', { replyTo: message.id });
      return;
    }
    const execution = command[1]!, reference = command[2]!.trim();
    if (!this.held(message, execution)) throw new Error('No owned unknown guard');
    const checkpoint = await this.native.recoveryCheckpoint(execution);
    if (Number(this.admission.store.drainStatus().queued)) throw new Error('Unstarted admitted backlog requires local inspection');
    this.admission.store.reconcile(message, execution, 'native-checkpoint/' + checkpoint + '\nOwner process/effects inspection: ' + reference);
  }

  sync(): void {
    for (const recovery of this.admission.store.recoveries()) {
      const target = recoveryNoticeTarget(this.admission, recovery);
      if (target) this.state.projectRecoveryNotice(recovery.origin, target);
    }
  }

  idle(): Promise<void> { return this.work; }
}
