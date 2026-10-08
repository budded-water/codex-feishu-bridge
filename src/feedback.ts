import { State, type FeedbackRecord } from './state.js';

export const RECEIVED_EMOJI = 'OnIt';

export interface ReactionPort {
  addReaction(message: string): Promise<string>;
  findReaction(message: string): Promise<string | undefined>;
  removeReaction(message: string, reaction: string): Promise<void>;
}

// Separate from reply delivery: slow or unavailable reactions cannot block answers.
export class Feedback {
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  constructor(private state: State, private port: ReactionPort) {}

  start(): void {
    this.timer = setInterval(() => { void this.flush(); }, 1000);
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.work) return this.work;
    this.work = Promise.all(this.state.pendingFeedback().map(row => this.deliver(row)))
      .then(() => {}).finally(() => { this.work = undefined; });
    return this.work;
  }

  private async deliver(row: FeedbackRecord): Promise<void> {
    try {
      let reaction = row.reaction;
      if (!reaction && row.uncertain) {
        reaction = await this.port.findReaction(row.message) ?? null;
        this.state.feedbackAdded(row.task, reaction);
      }
      const current = this.state.feedback(row.task);
      if (!current) return;
      if (['queued', 'running'].includes(current.status)) {
        if (!reaction) {
          // Persist intent before the HTTP call; reconcile an ambiguous response after restart.
          this.state.feedbackAttempt(row.task);
          reaction = await this.port.addReaction(row.message);
          this.state.feedbackAdded(row.task, reaction);
        }
      }
      // The task may have completed while the add/list request was in flight.
      if (!['queued', 'running'].includes(this.state.feedback(row.task)?.status ?? '')) {
        if (reaction) await this.port.removeReaction(row.message, reaction);
        this.state.feedbackFinished(row.task);
      }
    } catch {
      this.state.feedbackRetry(row);
      console.error('Reaction feedback unavailable; cleanup/reconciliation will retry');
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.work;
    await this.flush();
  }
}
