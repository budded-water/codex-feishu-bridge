import type { ReviewPresentation } from './review-card.js';
import type { DeliveryOptions } from './types.js';
import { State, type Delivery } from './state.js';
import type { ApprovalPresentation, ApprovalView } from './approval.js';
import { escapeTaskMarkdown, redactTaskPresentation, type TaskPresentation } from './task-card.js';

export interface Sender {
  send(chat: string, text: string, idempotencyKey: string, options?: DeliveryOptions): Promise<void | string>;
  updateApproval?(message: string, approval: ApprovalPresentation, view: ApprovalView): Promise<void>;
  updateReview?(message: string, presentation: ReviewPresentation): Promise<void>;
  updateTask?(message: string, presentation: TaskPresentation): Promise<void>;
}

export class Outbox {
  private state: State;
  private sender: Sender;
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private secrets: string[];

  constructor(state: State, sender: Sender, secrets: string[] = [], private ready?: (delivery: Delivery) => Promise<boolean>) {
    this.state = state;
    this.sender = sender;
    this.secrets = secrets.filter(secret => secret.length > 4);
  }

  start(): void {
    this.timer = setInterval(() => { void this.flush(); }, 1000);
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.work) return this.work;
    this.work = this.deliver().finally(() => { this.work = undefined; });
    return this.work;
  }

  private async deliver(): Promise<void> {
    for (const delivery of this.state.pending()) {
      if (!this.state.deliveryReady(delivery.id)) continue;
      if (this.ready && !await this.ready(delivery)) continue;
      if (!this.state.deliveryReady(delivery.id)) continue;
      let text = delivery.body;
      for (const secret of this.secrets) text = text.split(secret).join('[redacted]');
      const taskView = delivery.taskView && redactTaskPresentation(delivery.taskView, value => {
        // Retained Markdown may predate the current secret set.
        for (const secret of this.secrets) for (const variant of [secret, escapeTaskMarkdown(secret)]) value = value.split(variant).join('[redacted]');
        return value;
      });
      if (taskView) text = taskView.text;
      try {
        if (delivery.updateMessage && delivery.reviewCard) {
          if (!this.sender.updateReview) throw Error('Review card update transport unavailable');
          await this.sender.updateReview(delivery.updateMessage, delivery.reviewCard); this.state.delivered(delivery.id); continue;
        }
        if (delivery.updateMessage && taskView) {
          if (!this.sender.updateTask) throw new Error('Task update transport unavailable');
          await this.sender.updateTask(delivery.updateMessage, taskView);
          this.state.delivered(delivery.id);
          continue;
        }
        if (delivery.updateMessage && delivery.approval && delivery.approvalView) {
          if (!this.sender.updateApproval) throw new Error('Approval update transport unavailable');
          await this.sender.updateApproval(delivery.updateMessage, delivery.approval, delivery.approvalView);
          this.state.delivered(delivery.id);
          continue;
        }
        const message = await this.sender.send(delivery.chat, text, delivery.id, { replyTo: delivery.replyTo || undefined,
          mentions: delivery.mentions ? JSON.parse(delivery.mentions) : undefined, approval: delivery.approval, taskView, reviewCard: delivery.reviewCard });
        this.state.delivered(delivery.id, message || undefined);
      } catch {
        this.state.retry(delivery);
        console.error('Message delivery failed; stored result will be retried');
      }
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.work;
  }
}
