import type { Config } from '../config.js';
import { copyBlock, message as present, section } from '../presentation.js';
import type { State } from '../state.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { isMaintenanceOwner } from './owner-access.js';
import type { DeliveryCheckpoint, VerificationRecord } from './store.js';
import { verificationApplicabilityState, verificationDeliveryReference, type Applicability } from './verification-evidence.js';
import { fingerprint, type VerificationProfiles } from './verification-profile.js';
import { verificationApplicabilityText } from './verification-view.js';

const selector = /^\/(delivery(?:-wait|-confirm)?)\s+([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:[ \t]+([a-z0-9][a-z0-9:./_@+=?&%#-]{0,239}))?$/i;
const usage = present('交付等待', section('命令', [
  copyBlock('/delivery-wait 普通任务编号 证据引用'),
  copyBlock('/delivery-wait 验证任务编号'),
  copyBlock('/delivery 任务编号'),
  copyBlock('/delivery-confirm 任务编号 证据引用'),
  '确认命令下一行写后续任务。',
]));

export class OwnerDeliveries {
  private work = Promise.resolve();

  constructor(private admission: PilotAdmission, private config: Config, private state: State,
    private native: Pick<NativeExecutions, 'evidence'>, private profiles: VerificationProfiles) {}

  idle(): Promise<void> { return this.work; }

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
    const verification = execution && store.verification(execution);
    if (verification && ((command === 'delivery' && !reference && !hasInput) ||
        (command === 'delivery-wait' && !reference && !hasInput) ||
        (command === 'delivery-confirm' && reference && hasInput))) {
      this.work = this.work.then(() => this.verified(message, verification, command, reference, input))
        .catch(() => console.error('Delivery command could not complete; retry using its retained state'));
      return { status: 'delivery-view' as const };
    }
    let response = usage;
    if (execution && command === 'delivery' && !reference && !hasInput) {
      const checkpoint = store.deliveryCheckpoint(message, project, execution);
      response = checkpoint ? this.detail(checkpoint) : '未找到可查看的交付等待记录。';
    } else if (execution && !verification && command === 'delivery-wait' && reference && !hasInput) {
      const checkpoint = store.registerDelivery(message, project, execution, reference, () => this.sealedEvidence(execution));
      response = checkpoint ? this.detail(checkpoint) : '交付等待未登记。请核对原普通任务已完成、会话可续接，或者该任务是否已有不同证据。';
    } else if (execution && command === 'delivery-confirm' && reference && hasInput) {
      const result = store.resumeDelivery(message, project, execution, reference, input, () => this.sealedEvidence(execution));
      if (result === 'task-reply') return { status: result };
      response = '交付未续接。请用 /delivery 核对证据引用、确认情况和原任务状态。';
    }
    this.respond(message, response);
    return { status: 'delivery-view' as const };
  }

  private async verified(message: IncomingMessage, verification: VerificationRecord, command: string, reference: string | undefined, input: string) {
    const { store, project } = this.admission;
    const execution = verification.execution;
    if (this.state.hasSeen(message) || store.retained(message)) return;
    const checkpoint = store.deliveryCheckpoint(message, project, execution);
    if (command !== 'delivery-wait' && !checkpoint) {
      this.respond(message, '未找到可查看的交付等待记录。');
      return;
    }
    const expected = verificationDeliveryReference(verification);
    const source = store.ownedTask(execution, ownerKey(message), project);
    if (!expected || source?.message.chatType !== 'p2p') {
      this.respond(message, '交付证据不可用。请选择本人已完成、源码干净且通过的 Web 验证。');
      return;
    }
    if (command === 'delivery-confirm' && (checkpoint?.resumed || reference !== expected || checkpoint?.reference !== expected)) {
      this.respond(message, '交付未续接。请用 /delivery 核对登记的证据和确认状态。');
      return;
    }
    let applicability = await verificationApplicabilityState(verification, this.profiles);
    const seal = fingerprint(JSON.stringify(verification));
    const nativeEvidence = applicability === 'unchanged' && seal === store.verificationBinding(execution)
      ? this.sealedEvidence(execution) : undefined;
    if (applicability === 'unchanged' && (!nativeEvidence || store.execution(execution)?.evidence !== nativeEvidence)) applicability = 'unavailable';
    if (command === 'delivery' || applicability !== 'unchanged') {
      this.respond(message, checkpoint && command === 'delivery' ? this.detail(checkpoint, verification, applicability)
        : '交付未处理。' + verificationApplicabilityText(applicability));
      return;
    }
    if (command === 'delivery-wait') {
      const saved = store.registerDelivery(message, project, execution, expected, () => nativeEvidence);
      this.respond(message, saved ? this.detail(saved, verification, applicability) : '交付等待未登记。请核对原验证任务和会话。');
    } else if (store.resumeDelivery(message, project, execution, expected, input, () => nativeEvidence) !== 'task-reply') {
      this.respond(message, '交付未续接。请用 /delivery 核对登记的证据和确认状态。');
    }
  }

  private respond(message: IncomingMessage, response: string): void {
    this.state.transaction(() => {
      if (this.state.remember(message)) this.state.send(message.chat, response, { replyTo: message.id });
    });
  }

  private sealedEvidence(execution: string): string | undefined {
    try {
      const report = this.native.evidence(execution);
      if (report.outcome.status === 'completed') return 'native-checkpoint/' + report.checkpoint;
    } catch { /* Missing or changed files cannot confirm a delivery. */ }
  }

  private detail(checkpoint: DeliveryCheckpoint, verification?: VerificationRecord, applicability?: Applicability): string {
    const resumed = checkpoint.resumed && this.admission.store.request(checkpoint.resumed);
    return present('交付等待',
      checkpoint.resumed ? '已确认并登记续接。' : '等待确认这份证据。',
      section('原任务', [copyBlock('/task ' + checkpoint.execution)]),
      verification ? section('Web 验证通过 · ' + verification.profile, [
        '源码提交 ' + verification.observation?.gitHead,
        copyBlock('/verification ' + checkpoint.execution),
        ...(applicability ? [verificationApplicabilityText(applicability)] : []),
      ]) : undefined,
      section('已登记的证据引用', [copyBlock(checkpoint.reference)]),
      resumed ? section('续接任务', [copyBlock('/task ' + resumed.execution)])
        : applicability && applicability !== 'unchanged' ? undefined : section('确认并继续', [
          copyBlock('/delivery-confirm ' + checkpoint.execution + ' ' + checkpoint.reference),
          '粘贴后换行，写明后续任务。',
        ]));
  }
}
