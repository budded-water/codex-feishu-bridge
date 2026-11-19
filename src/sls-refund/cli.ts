import { readFileSync } from 'node:fs';
import { RefundObserver, isSecond } from './observer.js';
import { parseObserverConfig, readEvaluations } from './sls-source.js';
import { evidenceFrom, pollRefundObserver } from './poll.js';
import { record } from '../types.js';

function readInput(file: string): unknown {
  let contents: string;
  try { contents = readFileSync(file, 'utf8'); }
  catch { throw new Error('Observer input could not be read'); }
  return JSON.parse(contents);
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
      await pollRefundObserver(observer, config);
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
