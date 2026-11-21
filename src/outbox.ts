import { redactMatterPresentation } from './matter-card.js';
import type { ReviewPresentation } from './review-card.js';
import type { DeliveryOptions } from './types.js';
import { State, type Delivery } from './state.js';
import { ReplyTargetUnavailable, VisualReplyRejected } from './reply.js';
import type { ApprovalPresentation, ApprovalView } from './approval.js';
import { escapeTaskMarkdown, redactTaskPresentation, type TaskPresentation } from './task-card.js';
import type { VisualAttachment, VisualReviewView } from './visual-review.js';

export interface Sender {
  send(chat: string, text: string, idempotencyKey: string, options?: DeliveryOptions): Promise<void | string>;
  uploadImage?(png: Buffer): Promise<string>;
  updateApproval?(message: string, approval: ApprovalPresentation, view: ApprovalView): Promise<void>;
  updateReview?(message: string, presentation: ReviewPresentation): Promise<void>;
  updateTask?(message: string, presentation: TaskPresentation): Promise<void>;
  updateVisualReview?(message: string, body: string, images: VisualAttachment[], review: VisualReviewView): Promise<void>;
}

export class Outbox {
  private state: State;
  private sender: Sender;
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private visualWork?: Promise<void>;
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

  flushVisual(): Promise<void> {
    return this.visualWork ??= Promise.allSettled([this.deliver(true), this.updateVisualReviews()]).then(results => {
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    }).finally(() => { this.visualWork = undefined; });
  }

  private async deliver(visual = false): Promise<void> {
    for (const delivery of this.state.pending(Date.now(), visual)) {
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
        const visualImages = delivery.visualImages ? await this.uploadVisualImages(delivery, delivery.visualImages) : undefined;
        if (delivery.visualImages && (!visualImages || this.visualReceiptExpired(delivery))) continue;
        const message = await this.sender.send(delivery.chat, text, delivery.id, { replyTo: delivery.replyTo || undefined, visualImages,
          visualReview: visualImages ? this.state.visualReviews.view(delivery.id) : undefined,
          ...(delivery.visualExpires != null && { deliverBefore: delivery.visualExpires }),
          mentions: delivery.mentions ? JSON.parse(delivery.mentions) : undefined, approval: delivery.approval, taskView, reviewCard: delivery.reviewCard,
          matterCard: delivery.matterCard && redactMatterPresentation(delivery.matterCard, value => {
            for (const secret of this.secrets) if (secret) value = value.split(secret).join('[redacted]');
            return value;
          }) });
        this.state.delivered(delivery.id, message || undefined, visualImages);
      } catch (error) {
        if (delivery.visualImages && (error instanceof ReplyTargetUnavailable || error instanceof VisualReplyRejected)) {
          this.state.visualReceiptFailed(delivery.id, error instanceof ReplyTargetUnavailable ? 'target-unavailable' : 'content-rejected');
          console.error('Feishu rejected the visual receipt; the delivery will not be retried');
          continue;
        }
        if (delivery.visualExpires != null && Date.now() >= delivery.visualExpires) {
          this.state.visualReceiptFailed(delivery.id, 'delivery-unconfirmed');
          continue;
        }
        this.state.retry(delivery);
        console.error('Message delivery failed; stored result will be retried');
      }
    }
  }

  private async updateVisualReviews(): Promise<void> {
    for (const update of this.state.visualReviews.pendingUpdates(Date.now())) {
      let success = false;
      try {
        if (!this.sender.updateVisualReview) throw Error('Visual card update transport unavailable');
        let body = update.body;
        for (const secret of this.secrets) body = body.split(secret).join('[redacted]');
        await this.sender.updateVisualReview(update.message, body, update.images, update.card);
        success = true;
      } catch { console.error('Visual review card update unconfirmed'); }
      this.state.visualReviews.settleUpdate(update.card.id, update.revision, success);
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([this.work, this.visualWork]);
  }

  private visualReceiptExpired(delivery: Delivery): boolean {
    if (!delivery.visualImages || (delivery.visualExpires ?? 0) > Date.now()) return false;
    this.state.visualReceiptFailed(delivery.id, 'delivery-unconfirmed');
    return true;
  }

  private async uploadVisualImages(delivery: Delivery, attachments: NonNullable<Delivery['visualImages']>): Promise<DeliveryOptions['visualImages']> {
    const images = [];
    for (const image of attachments) {
      if (!image.key) {
        if (this.visualReceiptExpired(delivery)) return;
        if (!this.sender.uploadImage) throw Error('Visual receipt upload transport unavailable');
        image.key = await this.sender.uploadImage(Buffer.from(image.png, 'base64'));
        if (this.visualReceiptExpired(delivery)) return;
        image.png = '';
        this.state.saveVisualImages(delivery.id, attachments);
      }
      let caption = image.caption;
      for (const secret of this.secrets) caption = caption.split(secret).join('[redacted]');
      images.push({ caption, key: image.key });
    }
    return images;
  }
}
