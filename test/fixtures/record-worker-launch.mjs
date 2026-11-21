import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Let the Worker spend enough time before runner startup to distinguish its deadline from a fresh timer.
const run = Number(process.env.AGENT_AUTOLOOP_RUN);
const directory = dirname(process.env.AGENT_AUTOLOOP_CONTEXT);
const { run: recordedRun, job, launchedAt } = JSON.parse(readFileSync(join(directory, 'entry.json'), 'utf8'));
assert.ok(Number.isSafeInteger(run) && run > 0);
assert.equal(recordedRun, run);
assert.equal(job.run, run);
assert.ok(Number.isSafeInteger(launchedAt) && launchedAt > 0);
assert.ok(Number.isFinite(job.agent.timeout) && job.agent.timeout > 0);
await setTimeout(25_000);
const runnerStartedAt = Date.now();
writeFileSync(join(process.env.BRIDGE_PROBE_WORKER_LAUNCHES, run + '.json'),
  JSON.stringify({ run, rule: job.rule.name, launchedAt, runnerStartedAt, timeoutMinutes: job.agent.timeout }), { flag: 'wx' });

await import(pathToFileURL(process.env.BRIDGE_PROBE_REPAIR_RUNNER).href);
