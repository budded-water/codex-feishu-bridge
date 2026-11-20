import type { Config } from '../config.js';
import { copyBlock, message as present, section } from '../presentation.js';
import type { State } from '../state.js';
import type { IncomingMessage } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import { isMaintenanceOwner } from './owner-access.js';
import type { DeliveryCheckpoint } from './store.js';

const selector = /^\/(delivery(?:-wait|-confirm)?)\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[ \t]+([a-z0-9][a-z0-9:./_@+=?&%#-]{0,239}))?$/i;
const usage = present('交付等待', section('命令', [
  copyBlock('/delivery-wait 任务编号 证据引用'),
  copyBlock('/delivery 任务编号'),
  copyBlock('/delivery-confirm 任务编号 证据引用'),
  '确认命令下一行写后续任务。',
]));

export class OwnerDeliveries {
  constructor(private admission: PilotAdmission, private config: Config, private state: State) {}

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message)) return { status: 'ignored' as const };
    if (message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    if (this.state.hasSeen(message)) return { status: 'duplicate' as const };
    const newline = message.text.indexOf('\n');
    const header = newline === -1 ? message.text : message.text.slice(0, newline);
    const parsed = selector.exec(header.trim());
    const input = newline === -1 ? '' : message.text.slice(newline + 1);
    const hasInput = Boolean(input.trim());
    const command = parsed?.[1]?.toLowerCase(), execution = parsed?.[2]?.toLowerCase(), reference = parsed?.[3];
    const store = this.admission.store, project = this.admission.project;
    let response = usage;
    if (execution && command === 'delivery' && !reference && !hasInput) {
      const checkpoint = store.deliveryCheckpoint(message, project, execution);
      response = checkpoint ? this.detail(checkpoint) : '未找到可查看的交付等待记录。';
    } else if (execution && command === 'delivery-wait' && reference && !hasInput) {
      const checkpoint = store.registerDelivery(message, project, execution, reference);
      response = checkpoint ? this.detail(checkpoint) : '交付等待未登记。请核对原普通任务已完成、会话可续接，或者该任务是否已有不同证据。';
    } else if (execution && command === 'delivery-confirm' && reference && hasInput) {
      const result = store.resumeDelivery(message, project, execution, reference, input);
      if (result === 'task-reply') return { status: result };
      response = '交付未续接。请用 /delivery 核对证据引用、确认情况和原任务状态。';
    }
    this.state.transaction(() => {
      if (this.state.remember(message)) this.state.send(message.chat, response, { replyTo: message.id });
    });
    return { status: 'delivery-view' as const };
  }

  private detail(checkpoint: DeliveryCheckpoint): string {
    const resumed = checkpoint.resumed && this.admission.store.request(checkpoint.resumed);
    return present('交付等待',
      checkpoint.resumed ? '已确认并登记续接。' : '等待确认这份证据。',
      section('原任务', [copyBlock('/task ' + checkpoint.execution)]),
      section('已登记的证据引用', [copyBlock(checkpoint.reference)]),
      resumed ? section('续接任务', [copyBlock('/task ' + resumed.execution)])
        : section('确认并继续', [
          copyBlock('/delivery-confirm ' + checkpoint.execution + ' ' + checkpoint.reference),
          '粘贴后换行，写明后续任务。',
        ]));
  }
}
