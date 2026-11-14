// Started by the P0 Autoloop fixture plugin, never by the production entry point.
import { mkdirSync, mkdtempSync, realpathSync, lstatSync, rmSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createServer, type Socket } from 'node:net';
import lockfile from 'proper-lockfile';
import { CodexClient } from '../codex/client.js';
import { State } from '../state.js';
import { record, type IncomingMessage } from '../types.js';
import { AutoloopExecutionProbe, probeReceipt } from './autoloop-execution.js';

async function main(): Promise<void> {
  process.umask(0o077);
  const value = record(JSON.parse(process.argv[2] ?? '{}'));
  if (typeof value.folder !== 'string' || !isAbsolute(value.folder) ||
      typeof value.cwd !== 'string' || !isAbsolute(value.cwd) ||
      typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 29_900 ||
      (value.resume !== null && typeof value.resume !== 'string') ||
      !isAbsolute(process.env.AGENT_AUTOLOOP_HOME ?? '') ||
      !/^[1-9][0-9]*$/.test(process.env.AGENT_AUTOLOOP_RUN ?? '')) throw new Error('Invalid fixture assignment');
  const directory = realpathSync(value.cwd);
  // Autoloop attempt folders change after lease/retry. Identity must survive that change.
  const folder = join(realpathSync(process.env.AGENT_AUTOLOOP_HOME!), 'bridge-probe-executions', process.env.AGENT_AUTOLOOP_RUN!);
  const assignment = 'autoloop-run-' + process.env.AGENT_AUTOLOOP_RUN;
  const controlToken = process.env.BRIDGE_PROBE_CONTROL_TOKEN;
  if (!controlToken || controlToken.length < 24) throw new Error('Missing fixture control token');
  const executable = process.env.BRIDGE_PROBE_CODEX ?? 'codex';
  const prefix: unknown = JSON.parse(process.env.BRIDGE_PROBE_CODEX_PREFIX ?? '[]');
  if (!Array.isArray(prefix) || prefix.some(item => typeof item !== 'string')) throw new Error('Invalid fixture executable arguments');
  // The child retains native identity/config, but never gets orchestration/control credentials.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('AGENT_AUTOLOOP_') || name.startsWith('BRIDGE_PROBE_')) delete process.env[name];
  }
  mkdirSync(folder, { mode: 0o700, recursive: true });
  if (lstatSync(folder).isSymbolicLink()) throw new Error('Fixture state must not be a symlink');
  const release = await lockfile.lock(folder, { retries: 0, stale: 10_000 });
  try { await execute(); } finally { await release(); }

  async function execute(): Promise<void> {
    const state = new State(folder);
    const codex = new CodexClient(executable, prefix as string[]);
    const probe = new AutoloopExecutionProbe(state, codex, assignment, directory);
    // macOS Unix socket paths are short; the worker's nested state path can exceed the limit.
    const controlRoot = mkdtempSync('/tmp/cbp-');
    const socketPath = join(controlRoot, 'control.sock');
    const descriptor = join(folder, 'control.json');
    const clients = new Set<Socket>();
    const server = createServer(socket => {
      clients.add(socket);
      socket.once('close', () => clients.delete(socket));
      socket.setTimeout(2000, () => socket.destroy());
      let input = '';
      let handled = false;
      socket.on('error', () => {});
      socket.on('data', chunk => {
        if (handled) return;
        input += chunk.toString();
        if (Buffer.byteLength(input) > 64 * 1024) { socket.destroy(); return; }
        const end = input.indexOf('\n');
        if (end < 0) return;
        handled = true;
        try {
          const request = record(JSON.parse(input.slice(0, end)));
          if (request.token !== controlToken) throw new Error('Unauthenticated fixture control');
          if (request.message !== undefined) {
            const message = record(request.message);
            if (['tenant', 'user', 'chat', 'id', 'text'].some(key => typeof message[key] !== 'string')) throw new Error('Invalid fixture message');
            probe.control(message as unknown as IncomingMessage);
          }
          socket.end(JSON.stringify({ execution: probe.existing() ?? null, messages: probe.messages() }) + '\n');
        } catch { socket.end(JSON.stringify({ error: 'Fixture control rejected' }) + '\n'); }
      });
    });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      void probe.close();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    let progress: NodeJS.Timeout | undefined;
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
      writeFileSync(descriptor, JSON.stringify({ socket: socketPath }), { mode: 0o600 });
      let outcome = probe.existing();
      if (!outcome) {
        await codex.start();
        if (!stopping) {
          let last = '';
          progress = setInterval(() => {
            const current = probe.existing();
            if (current?.thread && current.thread !== last) {
              last = current.thread;
              console.log(JSON.stringify({ bridgeProbe: 1, session: current.thread, started: true }));
            }
          }, 10);
          outcome = await probe.run(value.prompt as string, value.resume as string | null);
        }
      }
      await probe.close();
      await codex.close(); // Publish terminal output only after observed native child exit.
      clearInterval(progress);
      outcome = outcome ?? probe.existing();
      console.log(JSON.stringify({
        bridgeProbe: 1, session: outcome?.thread, started: true,
        text: outcome?.receipt ?? probeReceipt('unknown'),
        execution: outcome ? { task: outcome.task, turn: outcome.turn, status: outcome.status } : null,
      }));
    } finally {
      clearInterval(progress);
      await probe.close();
      await codex.close();
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
      for (const client of clients) client.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(descriptor, { force: true });
      rmSync(controlRoot, { recursive: true, force: true });
      state.close();
    }
  }
}

void main().catch(() => {
  // A wrapper/setup failure is not authority to rerun a possibly accepted task.
  console.log(JSON.stringify({ bridgeProbe: 1, started: true, text: probeReceipt('unknown') }));
  process.exitCode = 1;
});
