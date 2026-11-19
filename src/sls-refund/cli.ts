import { readFileSync } from 'node:fs';
import { RefundObserver, isSecond, type Evidence } from './observer.js';
import { parseObserverConfig, readEvaluations, readEvidence, readSls } from './sls-source.js';
import { record } from '../types.js';

const overlapSeconds = 120;
const maxCatchupSeconds = 15 * 60;
const logDelaySeconds = 60;

function readInput(file: string): unknown {
  let contents: string;
  try { contents = readFileSync(file, 'utf8'); }
  catch { throw new Error('Observer input could not be read'); }
  return JSON.parse(contents);
}

function evidenceFrom(value: unknown): Evidence {
  if (value === undefined) return { backlog: [] };
  try { return readEvidence(value); }
  catch { return { backlog: [], unavailable: 'invalid-or-incomplete-source' }; }
}

async function main() {
  const [command, directory, file, ...extra] = process.argv.slice(2);
  if ((command !== 'replay' && command !== 'observe') || !directory || !file || extra.length) {
    throw new Error('Usage: sls:refund <replay|observe> <private-state-directory> <input-json>');
  }
  const data = record(readInput(file));
  const config = parseObserverConfig(command === 'replay' ? data.source : data, command === 'replay' ? 'replay' : 'live');
  const observer = new RefundObserver(directory, config.binding);
  try {
    if (command === 'replay') {
      if (!Array.isArray(data.frames) || !data.frames.length) throw new Error('Replay requires observation frames');
      for (const value of data.frames) {
        const frame = record(value);
        if (!isSecond(frame.from) || !isSecond(frame.to) || !isSecond(frame.now)) throw new Error('Replay frame times are invalid');
        observer.acceptWindow(frame.from, frame.to, readEvaluations(frame.evaluations, config.binding), frame.now);
        const sample = observer.nextSample(frame.now);
        if (sample) observer.observe(sample, frame.now, evidenceFrom(frame.evidence));
      }
    } else {
      const now = Math.floor(Date.now() / 1000);
      if (config.binding.start > now - logDelaySeconds) throw new Error('Live observation start has not reached the ingestion delay');
      const cursor = observer.through();
      const to = Math.min(now - logDelaySeconds, cursor + maxCatchupSeconds);
      if (to > cursor) {
        const from = Math.max(config.binding.start, cursor - overlapSeconds);
        observer.acceptWindow(from, to, readEvaluations(await readSls(config, 'evaluations', from, to), config.binding), now);
      }
      // If discovery is still catching up, do not close using incomplete incident history.
      const sample = to >= now - logDelaySeconds ? observer.nextSample(now) : undefined;
      if (sample) {
        let evidence: Evidence = { backlog: [] };
        const from = Math.max(0, now - 5 * 60);
        if (from < sample.evidenceThrough) {
          try { evidence = evidenceFrom(await readSls(config, 'evidence', from, sample.evidenceThrough)); }
          catch { evidence = { backlog: [], unavailable: 'source-query-failed' }; }
        }
        observer.observe(sample, now, evidence);
      }
    }
    console.log(JSON.stringify(observer.report(), null, 2));
  } finally {
    observer.close();
  }
}

main().catch(error => {
  // Provider responses and arbitrary local input are outside the reporting boundary.
  const message = error instanceof SyntaxError ? 'Invalid observer input JSON'
    : error instanceof Error && 'code' in error ? 'Observer local I/O failed'
    : error instanceof Error ? error.message : 'Observer failed';
  console.error(message);
  process.exitCode = 1;
});
