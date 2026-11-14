import { record } from '../types.js';
import { PilotAdmission, REQUEST_EVENT } from './gateway.js';
import type { Reservation, Submission } from './store.js';

type SourceReceipt = { event: number; routed: string[]; paused: string[] };
type SourceOutcome = SourceReceipt & { runs: { run: number; rule: string; state: string }[] };

function receipt(value: unknown): SourceReceipt {
  const body = record(value);
  if (!Number.isSafeInteger(body.event) || Number(body.event) < 1 ||
    !Array.isArray(body.routed) || body.routed.some(value => typeof value !== 'string') ||
    !Array.isArray(body.paused) || body.paused.some(value => typeof value !== 'string')) throw new Error('Invalid source receipt');
  return { event: Number(body.event), routed: body.routed as string[], paused: body.paused as string[] };
}

export class AutoloopSource {
  private url: URL;
  constructor(url: string, private key: string) {
    this.url = new URL(url.endsWith('/') ? url : url + '/');
    if (!['http:', 'https:'].includes(this.url.protocol) || this.url.username || this.url.password || this.url.search || this.url.hash || !key) throw new Error('Invalid source connection');
  }

  private async request(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(new URL(path, this.url), {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) throw new Error('Source request was not confirmed');
    return response.json();
  }

  async publish(id: string): Promise<SourceReceipt> {
    return receipt(await this.request('v1/events', { id, type: REQUEST_EVENT, subject: id, summary: 'Authorized pilot request' }));
  }

  async inspect(event: number): Promise<SourceOutcome> {
    const value = await this.request('v1/events/' + event);
    const accepted = receipt(value);
    const runs = record(value).runs;
    if (accepted.event !== event || !Array.isArray(runs) || runs.some(value => {
      const run = record(value);
      return !Number.isSafeInteger(run.run) || Number(run.run) < 1 || typeof run.rule !== 'string' || typeof run.state !== 'string';
    })) throw new Error('Invalid source outcome');
    return { ...accepted, runs: runs as SourceOutcome['runs'] };
  }
}

export class SourceOutbox {
  private work?: Promise<void>;
  constructor(private gateway: PilotAdmission, private source: AutoloopSource) {}

  flush(): Promise<void> {
    if (this.work) return this.work;
    this.work = this.deliver().finally(() => { this.work = undefined; });
    return this.work;
  }

  private async confirm(submission: Submission): Promise<SourceOutcome> {
    const request = this.gateway.store.request(submission.request);
    if (!request) throw new Error('Missing admitted request');
    if (request.message.chatType === 'group' && !this.gateway.store.reference(request.execution, request.message)) throw new Error('Group references have not been prepared');
    let event = submission.event;
    if (event === null) {
      const posted = await this.source.publish(submission.request);
      event = posted.event;
      this.gateway.store.rememberEvent(submission.request, event);
    }
    const outcome = await this.source.inspect(event);
    const expected = this.gateway.scope.rule;
    const valid = outcome.routed.length === 1 && outcome.routed[0] === expected && !outcome.paused.length &&
      outcome.runs.length === 1 && outcome.runs[0]!.rule === expected;
    this.gateway.store.routed(submission.request, valid);
    if (!valid) throw new Error('Source event did not route to one expected run');
    return outcome;
  }

  async claim(value: unknown): Promise<Reservation> {
    return this.reserve(this.gateway.assignment(value));
  }

  async claimContext(run: number, cwd: string, context: unknown): Promise<Reservation> {
    return this.reserve(this.gateway.assignmentContext(run, cwd, context));
  }

  private async reserve({ request, run }: ReturnType<PilotAdmission['assignment']>): Promise<Reservation> {
    const submission = this.gateway.store.submission(request.id);
    if (request.blocked || submission?.status === 'blocked') return { kind: 'blocked' };
    if (!submission) throw new Error('Assignment has no submission intent');
    const outcome = await this.confirm({ request: request.id, event: submission.event, attempts: submission.attempts });
    if (outcome.runs[0]!.run !== run || outcome.runs[0]!.state !== 'claimed') throw new Error('Assignment is not the source event\'s active run');
    return this.gateway.store.reserve(request.id, run);
  }

  private async deliver(): Promise<void> {
    for (const submission of this.gateway.store.pending()) {
      try {
        await this.confirm(submission);
      } catch {
        this.gateway.store.retry(submission.request);
      }
    }
  }
}
