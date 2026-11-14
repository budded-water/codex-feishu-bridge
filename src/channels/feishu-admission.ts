import { normalizeMessage } from '../feishu.js';
import { PilotAdmission, type Admission } from '../handoff/gateway.js';

export class FeishuAdmission {
  constructor(private gateway: PilotAdmission, private botOpenId: string) {
    if (!/^ou_[\w-]+$/.test(botOpenId)) throw new Error('Invalid bot identity');
    gateway.store.bindChannel('feishu', botOpenId);
  }

  receive(event: unknown): Admission {
    const message = normalizeMessage(event, this.botOpenId);
    return message ? this.gateway.receive(message) : { status: 'ignored' };
  }

  reconcile(event: unknown, decision: Parameters<PilotAdmission['reconcile']>[1]): void {
    const message = normalizeMessage(event, this.botOpenId);
    if (!message) throw new Error('Invalid recovery message');
    this.gateway.reconcile(message, decision);
  }
}
