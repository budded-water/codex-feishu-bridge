import type { RefundObserver, Evidence } from './observer.js';
import { readEvaluations, readEvidence, readSls, type ObserverConfig } from './sls-source.js';

const overlapSeconds = 120;
const maxCatchupSeconds = 15 * 60;
export const logDelaySeconds = 60;

export function evidenceFrom(value: unknown): Evidence {
  if (value === undefined) return { backlog: [] };
  try { return readEvidence(value); }
  catch { return { backlog: [], unavailable: 'invalid-or-incomplete-source' }; }
}

export async function pollRefundObserver(observer: RefundObserver, config: ObserverConfig,
  { now = Math.floor(Date.now() / 1000), read = readSls, canContinue = () => true, subscription = false }:
  { now?: number; read?: typeof readSls; canContinue?: () => boolean; subscription?: boolean } = {}): Promise<boolean> {
  if (config.binding.start > now - logDelaySeconds) throw new Error('Live observation start has not reached the ingestion delay');
  if (subscription) {
    const closure = observer.nextClosureCheck(now);
    if (closure) {
      const from = Math.max(config.binding.start, closure.through - overlapSeconds);
      observer.acceptWindow(from, closure.through,
        readEvaluations(await read(config, 'evaluations', from, closure.through), config.binding), now);
      observer.finishClosureCheck(closure.incident);
    }
    if (!canContinue()) return false;
    if (!observer.nextSample(now) && !observer.notificationReadDue(now - logDelaySeconds)) return true;
  }
  const cursor = observer.discoveryCursor();
  const to = Math.min(now - logDelaySeconds, cursor + maxCatchupSeconds);
  if (to > cursor) {
    const from = Math.max(config.binding.start, cursor - overlapSeconds);
    observer.acceptWindow(from, to, readEvaluations(await read(config, 'evaluations', from, to), config.binding), now);
  }
  if (!canContinue()) return false;
  // If discovery is still catching up, do not close using incomplete incident history.
  const caughtUp = to >= now - logDelaySeconds;
  if (caughtUp && subscription) observer.finishNotificationReads(now);
  const sample = caughtUp ? observer.nextSample(now) : undefined;
  if (sample) {
    let evidence: Evidence = { backlog: [] };
    const from = Math.max(0, now - 5 * 60);
    if (from < sample.evidenceThrough) {
      try { evidence = evidenceFrom(await read(config, 'evidence', from, sample.evidenceThrough)); }
      catch { evidence = { backlog: [], unavailable: 'source-query-failed' }; }
    }
    observer.observe(sample, now, evidence, subscription ? now + overlapSeconds : undefined);
  }
  return caughtUp;
}
