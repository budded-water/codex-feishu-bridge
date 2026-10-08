import { mkdirSync } from 'node:fs';
import lockfile from 'proper-lockfile';
import { loadConfig, credentials } from './config.js';
import { CodexClient, checkVersion } from './codex/client.js';
import { Bridge } from './bridge.js';
import { State } from './state.js';
import { Feishu } from './feishu.js';
import { Feedback } from './feedback.js';
import { Outbox } from './outbox.js';

async function main(): Promise<void> {
  const config = loadConfig(process.env.BRIDGE_CONFIG ?? 'bridge.config.json');
  const auth = credentials();
  if (process.argv[2] === 'doctor') {
    await checkVersion(config.codexExecutable);
    console.log(`Configuration and Codex protocol version OK; ${Object.keys(config.projects).length} project(s) registered.`);
    console.log('Doctor does not connect to Feishu, run inference, or verify external app permissions.');
    return;
  }
  if (process.argv[2]) throw new Error('Usage: bridge [doctor]');
  process.umask(0o077);
  mkdirSync(config.stateDirectory, { recursive: true, mode: 0o700 });
  let compromised = false;
  let shutdown: (() => Promise<void>) | undefined;
  const release = await lockfile.lock(config.stateDirectory, {
    retries: 0, stale: 10_000,
    onCompromised: () => {
      compromised = true;
      console.error('State lock lost; shutting down to prevent duplicate execution');
      void shutdown?.();
    },
  });
  let state: State;
  try {
    state = new State(config.stateDirectory);
    state.recover();
  } catch {
    await release();
    throw new Error('Cannot initialize local state');
  }
  const codex = new CodexClient(config.codexExecutable);
  const feishu = new Feishu(auth, config.enableGroups, config.groupContextImages);
  const bridge = new Bridge(config, state, codex, feishu);
  const outbox = new Outbox(state, feishu, [auth.appSecret, process.env.OPENAI_API_KEY ?? '']);
  const feedback = new Feedback(state, feishu);
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
    feishu.close();
    closing = (async () => {
      await bridge.close();
      await codex.close();
      await outbox.close();
      await feedback.close();
      state.close();
      await release().catch(() => {});
      console.log('Bridge stopped');
    })();
    return closing;
  };
  const stop = (): void => { void shutdown!().catch(() => { process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (compromised) throw new Error('State lock unavailable');
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
    await shutdown();
    throw new Error('Bridge startup failed; run npm run doctor and verify Feishu application settings');
  }
}

void main().catch(error => {
  // Only our own setup errors are displayed. Do not print SDK responses or credentials.
  console.error(error instanceof Error ? error.message.replace(/\/[^\s]+/g, '[path]') : 'Bridge failed');
  process.exitCode = 1;
});
