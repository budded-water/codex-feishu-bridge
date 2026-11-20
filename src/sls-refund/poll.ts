import { freshBacklog, type BacklogSupplement, type DueSample, type RefundObserver, type Evidence } from './observer.js';
import { readEvaluations, readEvidence, readSls, type ObserverConfig } from './sls-source.js';

const overlapSeconds = 120;
const maxCatchupSeconds = 15 * 60;
const diagnosticSeconds = 15;
export const logDelaySeconds = 60;

export function evidenceFrom(value: unknown): Evidence {
  if (value === undefined) return { backlog: [] };
  try { return readEvidence(value); }
  catch { return { backlog: [], unavailable: 'invalid-or-incomplete-source' }; }
}

async function readBacklogSupplement(evidence: Evidence, sample: DueSample, now: number, config: ObserverConfig,
  read: typeof readSls, canContinue: () => boolean): Promise<BacklogSupplement | undefined> {
  const [known] = evidence.backlog;
  const from = sample.evidenceThrough;
  const through = Math.min(now, from + diagnosticSeconds);
  if (sample.slot !== 2 || evidence.unavailable || !evidence.backlogRun || evidence.backlog.length !== 1 || !known ||
    !freshBacklog(known, now, sample.firing + 1, from) || from >= through || !canContinue()) return;
  const channel = known.channel === 'wechat_pay' ? 'alipay' : 'wechat_pay';
  const target = { through, channel } as const;
  try {
    const extra = readEvidence(await read(config, 'evidence', from, through), evidence.backlogRun);
    if (extra.unavailable || extra.backlog.some(row => !freshBacklog(row, now, from, through))) return { ...target, status: 'unavailable' };
    const row = extra.backlog.find(row => row.channel === channel);
    return row ? { ...target, status: 'matched', row } : { ...target, status: 'not-found' };
  } catch { return { ...target, status: 'unavailable' }; }
}

export async function pollRefundObserver(observer: RefundObserver, config: ObserverConfig,
  { now = Math.floor(Date.now() / 1000), read = readSls, canContinue = () => true, subscription = false }:
  { now?: number; read?: typeof readSls; canContinue?: () => boolean; subscription?: boolean } = {}): Promise<boolean> {
  if (config.binding.start > now - logDelaySeconds) throw new Error('Live observation start has not reached the ingestion delay');
  if (subscription) {
    const closure = observer.nextClosureCheck(now);
    if (closure) {
      const to = Math.min(closure.through, closure.checkpoint + maxCatchupSeconds);
      observer.acceptWindow(closure.checkpoint, to,
        readEvaluations(await read(config, 'evaluations', closure.checkpoint, to), config.binding), now);
      observer.advanceClosureCheck(closure.incident, to);
    }
    if (!canContinue()) return false;
    if (!observer.nextSample(now, true) && !observer.notificationReadDue(now - logDelaySeconds)) return true;
  }
  const cursor = subscription ? observer.discoveryCursor() : observer.through();
  const to = Math.min(now - logDelaySeconds, cursor + maxCatchupSeconds);
  if (to > cursor) {
    const from = Math.max(config.binding.start, cursor - overlapSeconds);
    observer.acceptWindow(from, to, readEvaluations(await read(config, 'evaluations', from, to), config.binding), now);
  }
  if (!canContinue()) return false;
  // If discovery is still catching up, do not close using incomplete incident history.
  const caughtUp = to >= now - logDelaySeconds;
  if (caughtUp && observer.notificationReadDue(to)) observer.finishNotificationReads(now);
  const sample = caughtUp ? observer.nextSample(now, true) : undefined;
  if (sample) {
    let evidence: Evidence = { backlog: [] };
    const from = Math.max(0, now - 5 * 60);
    if (from < sample.evidenceThrough) {
      try { evidence = evidenceFrom(await read(config, 'evidence', from, sample.evidenceThrough)); }
      catch { evidence = { backlog: [], unavailable: 'source-query-failed' }; }
    }
    const backlogSupplement = await readBacklogSupplement(evidence, sample, now, config, read, canContinue);
    observer.observe(sample, now, backlogSupplement ? { ...evidence, backlogSupplement } : evidence,
      subscription ? now + overlapSeconds : undefined);
  }
  return caughtUp;
}
