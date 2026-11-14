import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { loadConfig } from '../config.js';
import { CodexClient } from '../codex/client.js';
import { record } from '../types.js';
import { PilotAdmission, type PilotScope } from './gateway.js';
import { AutoloopSource, SourceOutbox } from './source.js';
import { NativeExecutions, type NativeReport } from './native.js';
import { validateNativeRegistry } from './registry.js';
import { readFence, verifyImportedState } from './ownership.js';
import { executionReceipt } from './receipt.js';

async function main(): Promise<void> {
  process.umask(0o077);
  const turn = record(JSON.parse(process.argv[2] ?? '{}'));
  const configFile = process.env.HANDOFF_CONFIG;
  const contextFile = process.env.AGENT_AUTOLOOP_CONTEXT;
  const home = process.env.AGENT_AUTOLOOP_HOME;
  const sourceKey = process.env.HANDOFF_SOURCE_KEY;
  const run = Number(process.env.AGENT_AUTOLOOP_RUN);
  if (!configFile || !contextFile || !home || !sourceKey || !Number.isSafeInteger(run) || run < 1 ||
    typeof turn.cwd !== 'string' || !isAbsolute(turn.cwd) || typeof turn.contextFile !== 'string' ||
    realpathSync(turn.contextFile) !== realpathSync(contextFile)) throw new Error('Invalid native assignment entry');
  const value = record(JSON.parse(readFileSync(configFile, 'utf8')));
  if (typeof value.stateDirectory !== 'string' || !isAbsolute(value.stateDirectory) || typeof value.bridgeConfig !== 'string' ||
    !isAbsolute(value.bridgeConfig) || typeof value.hubUrl !== 'string') throw new Error('Invalid native assignment configuration');
  const prefix: unknown = JSON.parse(process.env.HANDOFF_CODEX_PREFIX ?? '[]');
  if (!Array.isArray(prefix) || prefix.some(item => typeof item !== 'string')) throw new Error('Invalid native executable prefix');
  const config = loadConfig(value.bridgeConfig);
  if (realpathSync(config.stateDirectory) !== realpathSync(value.stateDirectory)) {
    const owner = readFence(realpathSync(config.stateDirectory));
    if (owner?.role !== 'pilot' || owner.data !== realpathSync(value.stateDirectory)) throw new Error('Worker no longer owns pilot state');
    verifyImportedState(owner.data, owner.operation);
  }
  const gateway = new PilotAdmission(value.stateDirectory, record(value.scope) as unknown as PilotScope, config.projectRouting);
  let runtime: NativeExecutions | undefined;
  let progress: NodeJS.Timeout | undefined;
  let probing = false;
  const stop = () => { void runtime?.stop(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    validateNativeRegistry(gateway, JSON.parse(readFileSync(join(home, 'rules.json'), 'utf8')));
    const outbox = new SourceOutbox(gateway, new AutoloopSource(value.hubUrl, sourceKey));
    runtime = new NativeExecutions(gateway, config, () => new CodexClient(config.codexExecutable, prefix as string[], 30_000, config.codexReasoningEffort));
    await runtime.recover();
    const grant = await outbox.claimContext(run, turn.cwd, JSON.parse(readFileSync(contextFile, 'utf8')));
    let report: NativeReport | undefined;
    if (grant.kind === 'start') {
      let thread: string | undefined;
      progress = setInterval(async () => {
        if (probing) return;
        probing = true;
        try {
          const snapshot = await runtime!.inspect(grant.permit.execution);
          if (typeof snapshot.thread === 'string' && snapshot.thread !== thread) {
            thread = snapshot.thread;
            console.log(JSON.stringify({ nativeExecution: 1, session: thread, started: true }));
          }
        } catch { /* The owner publishes its endpoint before native work starts. */ }
        finally { probing = false; }
      }, 250);
      report = await runtime.run(grant.permit);
    } else if (grant.kind === 'existing') {
      try { report = runtime.apply(grant.execution.id); } catch { /* Retain an unresolved existing execution. */ }
    }
    clearInterval(progress);
    console.log(JSON.stringify({ nativeExecution: 1, started: true, session: report?.outcome.thread ?? undefined,
      text: executionReceipt(grant.kind === 'withdrawn' ? 'withdrawn' : report?.outcome.status ?? 'unknown') }));
  } finally {
    clearInterval(progress);
    await runtime?.stop();
    process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    gateway.close();
  }
}

void main().catch(() => {
  console.log(JSON.stringify({ nativeExecution: 1, started: true, text: executionReceipt('unknown') }));
  process.exitCode = 1;
});
