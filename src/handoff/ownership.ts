import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, writeFileSync, renameSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { record } from '../types.js';
import { CODEX_VERSION } from '../codex/generated/version.js';
import { openOwnerChannel, requestOwner } from './owner-channel.js';

export type RuntimeRole = 'legacy' | 'pilot';
export interface Fence { version: 1; role: RuntimeRole; root: string; data: string; operation: string }
export const fenceFile = 'handoff-owner.json';
export const controllerFile = 'runtime-control.json';

export function writePrivate(path: string, value: unknown): void {
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, path);
}

export function privateRecord(path: string): Record<string, unknown> {
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 1024 * 1024) throw new Error('Invalid private state record');
  return record(JSON.parse(readFileSync(path, 'utf8')));
}

export function readFence(root: string): Fence | undefined {
  let value: Record<string, unknown>;
  try { value = privateRecord(join(root, fenceFile)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (value.version !== 1 || value.root !== root || !['legacy', 'pilot'].includes(String(value.role)) ||
    typeof value.data !== 'string' || typeof value.operation !== 'string') throw new Error('Invalid handoff owner record');
  return value as unknown as Fence;
}

export function verifyImportedState(data: string, operation: string): void {
  for (const name of ['handoff.db', 'transport/bridge.db']) {
    const path = join(data, name);
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Prepared state file is missing');
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare('SELECT operation FROM handoff_import WHERE id=1').get();
      if (row?.operation !== operation) throw new Error('Prepared state identity changed');
    } finally { db.close(); }
  }
}

export async function acquireRoot(root: string, role: RuntimeRole, data: string, compromised: () => void = () => {}) {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) throw new Error('Ownership directory must not be a symlink');
  root = realpathSync(root);
  data = realpathSync(data);
  let lost = false;
  const release = await lockfile.lock(root, { retries: 0, stale: 10_000, onCompromised: () => { lost = true; compromised(); } });
  const assertHeld = () => { if (lost) throw new Error('Consumer ownership was lost'); };
  try {
    const fence = readFence(root);
    if (fence ? fence.role !== role || fence.data !== data : role !== 'legacy' || data !== root) throw new Error('Runtime does not own this consumer state');
    if (fence && role === 'legacy') {
      const file = lstatSync(join(root, 'bridge.db'));
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('Restored legacy state is missing');
    }
  } catch (error) { await release(); throw error; }
  return { root, role, data, release, assertHeld };
}

export type RootLease = Awaited<ReturnType<typeof acquireRoot>>;

export async function openRuntimeControl(lease: RootLease, handle: (request: Record<string, unknown>) => unknown) {
  const epoch = randomUUID(), token = randomUUID();
  const channel = await openOwnerChannel(token, epoch, handle);
  const descriptor = { version: 1, protocol: CODEX_VERSION, epoch, token, socket: channel.path,
    root: lease.root, role: lease.role, data: lease.data, pid: process.pid, phase: 'active' };
  try { writePrivate(join(lease.root, controllerFile), descriptor); }
  catch (error) { await channel.close(); throw error; }
  return {
    close: async (settled: boolean) => {
      await channel.close();
      if (settled) {
        lease.assertHeld();
        if (privateRecord(join(lease.root, controllerFile)).epoch !== epoch) throw new Error('Runtime identity changed');
        writePrivate(join(lease.root, controllerFile), { ...descriptor, phase: 'closed' });
      }
    },
  };
}

export function requireClosed(root: string, role: RuntimeRole, data: string): void {
  const value = privateRecord(join(root, controllerFile));
  if (value.version !== 1 || value.protocol !== CODEX_VERSION || value.root !== root || value.role !== role ||
    value.data !== data || value.phase !== 'closed') throw new Error('Runtime closure has not been confirmed');
}

export async function manageRuntime(root: string, command: string, task?: string, reference?: string) {
  root = realpathSync(root);
  const value = privateRecord(join(root, controllerFile));
  if (value.version !== 1 || value.protocol !== CODEX_VERSION || value.root !== root || value.phase !== 'active' || typeof value.socket !== 'string' ||
    typeof value.token !== 'string' || typeof value.epoch !== 'string') throw new Error('No active managed runtime');
  return requestOwner(value.socket, value.token, value.epoch, { command, task, reference });
}
