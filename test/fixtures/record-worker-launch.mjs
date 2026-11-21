import assert from 'node:assert/strict';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// This wrapper only changes the launch timing of the isolated rejection case.
const run = Number(process.env.AGENT_AUTOLOOP_RUN);
const directory = dirname(process.env.AGENT_AUTOLOOP_CONTEXT);
const { run: recordedRun, job, launchedAt } = JSON.parse(readFileSync(join(directory, 'entry.json'), 'utf8'));
assert.ok(Number.isSafeInteger(run) && run > 0);
assert.equal(recordedRun, run);
assert.equal(job.run, run);
assert.ok(Number.isSafeInteger(launchedAt) && launchedAt > 0);
assert.ok(Number.isFinite(job.agent.timeout) && job.agent.timeout > 0);
const budget = JSON.parse(readFileSync(process.env.BRIDGE_PROBE_WORKER_BUDGET_CASE, 'utf8'));
const { events } = JSON.parse(readFileSync(process.env.AGENT_AUTOLOOP_CONTEXT, 'utf8'));
const rejection = events.length === 1 && events[0].id === budget.request;
const workerDeadline = launchedAt + job.agent.timeout * 60_000;
let invalidTiming = rejection && !(budget.deadline < workerDeadline && workerDeadline < budget.cleanupDeadline);
if (rejection && !invalidTiming) {
  // A fresh timer would fit cleanup, while the real Worker deadline does not.
  await setTimeout(budget.cleanupDeadline - workerDeadline + 1000);
}
const runnerStartedAt = Date.now();
if (rejection && (runnerStartedAt >= budget.deadline || runnerStartedAt + job.agent.timeout * 60_000 <= budget.cleanupDeadline)) {
  invalidTiming = true;
}
const capture = join(process.env.BRIDGE_PROBE_WORKER_LAUNCHES, run + '.json');
writeFileSync(capture + '.tmp',
  JSON.stringify({ run, rule: job.rule.name, launchedAt, runnerStartedAt, invalidTiming, timeoutMinutes: job.agent.timeout }), { flag: 'wx' });

renameSync(capture + '.tmp', capture);
if (invalidTiming) throw new Error('Invalid deadline fixture setup');
await import(pathToFileURL(process.env.BRIDGE_PROBE_REPAIR_RUNNER).href);
