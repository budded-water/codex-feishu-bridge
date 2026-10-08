import { State } from './state.js';

export interface Sender {
  send(chat: string, text: string, idempotencyKey: string): Promise<void>;
}

export class Outbox {
  private state: State;
  private sender: Sender;
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private secrets: string[];

  constructor(state: State, sender: Sender, secrets: string[] = []) {
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
      let text = delivery.body;
      for (const secret of this.secrets) text = text.split(secret).join('[redacted]');
      try {
        await this.sender.send(delivery.chat, text, delivery.id);
        this.state.delivered(delivery.id);
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
