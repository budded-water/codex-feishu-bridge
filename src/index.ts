import { mkdirSync } from 'node:fs';
import { acquireRoot, openRuntimeControl } from './handoff/ownership.js';
import { record } from './types.js';
import { loadConfig, credentials } from './config.js';
import { CodexClient, checkVersion } from './codex/client.js';
import { Bridge } from './bridge.js';
import { State } from './state.js';
import { Feishu } from './feishu.js';
import { Feedback } from './feedback.js';
import { Outbox } from './outbox.js';

async function main(): Promise<void> {
  const configPath = process.env.BRIDGE_CONFIG ?? 'bridge.config.json';
  const config = loadConfig(configPath);
  const auth = credentials();
  if (process.argv[2] === 'doctor') {
    await checkVersion(config.codexExecutable);
    console.log(`Configuration and Codex protocol version OK; ${Object.keys(config.projects).length} project(s) registered.`);
    console.log('Doctor does not connect to Feishu, run inference, or verify external app permissions.');
    return;
  }
  if (process.argv[2] === 'handoff') {
    const { startPilot } = await import('./handoff/start.js');
    await startPilot(config, auth, configPath);
    return;
  }
  if (process.argv[2]) throw new Error('Usage: bridge [doctor|handoff]');
  process.umask(0o077);
  mkdirSync(config.stateDirectory, { recursive: true, mode: 0o700 });
  let compromised = false;
  let shutdown: (() => Promise<void>) | undefined;
  const lease = await acquireRoot(config.stateDirectory, 'legacy', config.stateDirectory, () => {
    compromised = true;
    console.error('State lock lost, shutting down');
    void shutdown?.();
  });
  const release = lease.release;
  let state: State | undefined;
  const control = await openRuntimeControl(lease, request => {
    if (!state) throw new Error('Runtime is opening');
    if (request.command === 'quiesce') state.maintenance.quiesce();
    else if (request.command === 'resume') state.maintenance.resume();
    else if (request.command === 'reconcile') {
      const value = record(request);
      if (typeof value.task !== 'string' || typeof value.reference !== 'string') throw new Error('Missing recovery evidence');
      state.reconcileForMigration(value.task, value.reference);
    } else if (request.command !== 'status') throw new Error('Unsupported maintenance operation');
    return state.drainStatus();
  }).catch(async error => { await release(); throw error; });
  const secrets = [auth.appSecret, process.env.OPENAI_API_KEY ?? ''];
  try {
    state = new State(config.stateDirectory, secrets);
    state.recover();
  } catch {
    state?.close();
    await control.close(true);
    await release();
    throw new Error('Cannot initialize local state');
  }
  const codex = new CodexClient(config.codexExecutable, [], 30_000, config.codexReasoningEffort);
  const feishu = new Feishu(auth, config.enableGroups, config.groupContextImages);
  const bridge = new Bridge(config, state, codex, feishu);
  const outbox = new Outbox(state, feishu, secrets);
  const feedback = new Feedback(state, feishu);
  let unsubscribeFeishu: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  let stopping = false;
  let restart: NodeJS.Timeout | undefined;
  let attempts = 0;
  let healthy: NodeJS.Timeout | undefined;
  const restartCodex = async (): Promise<void> => {
    if (stopping) return;
    try {
      await codex.start();
      if (stopping) { await codex.close(); return; }
      bridge.kick();
      healthy = setTimeout(() => { attempts = 0; }, 60_000);
      console.log('Local Codex ready');
    } catch {
      console.error('Local Codex unavailable; retrying with backoff');
      schedule();
    }
  };
  const schedule = (): void => {
    if (stopping || restart) return;
    if (healthy) clearTimeout(healthy);
    if (++attempts > 5) {
      console.error('Codex restart budget exhausted; restart the bridge after checking the local installation');
      return;
    }
    restart = setTimeout(() => { restart = undefined; void restartCodex(); }, Math.min(30_000, 1000 * 2 ** attempts));
  };
  const unsubscribe = codex.onExit(schedule);
  shutdown = () => {
    if (closing) return closing;
    stopping = true;
    if (restart) clearTimeout(restart);
    if (healthy) clearTimeout(healthy);
    unsubscribe();
    unsubscribeFeishu?.();
    feishu.close();
    closing = (async () => {
      await bridge.close();
      await codex.close();
      await outbox.close();
      await feedback.close();
      state!.close();
      await control.close(true);
      await release().catch(() => {});
      console.log('Bridge stopped');
    })();
    return closing;
  };
  const stop = (): void => { void shutdown!().catch(() => { process.exitCode = 1; }); };
  unsubscribeFeishu = feishu.onFailure(() => { process.exitCode = 1; stop(); });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (compromised) throw new Error('State lock unavailable');
    lease.assertHeld();
    await codex.start();
    if (stopping) return;
    outbox.start();
    feedback.start();
    await feishu.start(message => {
      try { bridge.receive(message); void feedback.flush(); void outbox.flush(); }
      catch { console.error('Message could not be persisted; Feishu may retry the event'); throw new Error('Local message processing failed'); }
    });
    if (!stopping) console.log('Bridge running; configured tenant/user access and per-user sessions are enforced');
  } catch {
    const intentionalStop = stopping;
    await shutdown();
    if (intentionalStop) return;
    throw new Error('Bridge startup failed; run npm run doctor and verify Feishu application settings');
  }
}

void main().catch(error => {
  // Only our own setup errors are displayed. Do not print SDK responses or credentials.
  console.error(error instanceof Error ? error.message.replace(/\/[^\s]+/g, '[path]') : 'Bridge failed');
  process.exitCode = 1;
});
