import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { record } from '../types.js';
import { writePrivate } from './ownership.js';

export type ProcessIdentity = { pid: number; started: string };
export type RegisteredProcess = ProcessIdentity & { parent: ProcessIdentity };
export type ProcessRow = ProcessIdentity & { ppid: number; state: string };
export type ProcessTable = Map<number, ProcessRow>;
export type ProcessObservation = {
  version: 1; binding: string; observedAt: number; available: boolean; truncated: boolean;
  owner: ProcessIdentity | null; native: RegisteredProcess | null; descendants: RegisteredProcess[];
};
export const MAX_OBSERVED_DESCENDANTS = 64;
const key = (value: ProcessIdentity) => value.pid + ':' + value.started;
const identity = (row: ProcessIdentity): ProcessIdentity => ({ pid: row.pid, started: row.started });
const same = (a: ProcessIdentity, b: ProcessIdentity) => key(a) === key(b);

export async function readProcessTable(): Promise<ProcessTable> {
  const { stdout } = await promisify(execFile)('/bin/ps', ['-axo', 'pid=,ppid=,stat=,lstart='], {
    encoding: 'utf8', timeout: 1000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
  });
  const table: ProcessTable = new Map();
  for (const line of stdout.split('\n').filter(line => line.trim())) {
    const fields = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!fields) throw new Error('Unrecognized process observation');
    const started = fields[4]!.replace(/\s+/g, ' ');
    if (!/^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(started)) throw new Error('Unrecognized process start time');
    const row = { pid: Number(fields[1]), ppid: Number(fields[2]), state: fields[3]!, started };
    if (!Number.isSafeInteger(row.pid) || !Number.isSafeInteger(row.ppid)) throw new Error('Invalid process identity');
    table.set(row.pid, row);
  }
  if (!table.size) throw new Error('Empty process observation');
  return table;
}

function processPresent(pid: number): boolean | null {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' ? false : null; }
}

export function processState(value: ProcessIdentity | null, table: ProcessTable | null, present: (pid: number) => boolean | null = processPresent): 'running' | 'exited' | 'unverified' {
  if (!value || !table) return 'unverified';
  const current = table.get(value.pid);
  if (!current) return present(value.pid) === false ? 'exited' : 'unverified';
  if (!same(value, current)) return 'unverified';
  return current.state.startsWith('Z') ? 'exited' : 'running';
}

export function registerProcesses(observation: ProcessObservation, ownerPid: number, nativePid: number, table: ProcessTable): void {
  const owner = table.get(ownerPid), native = table.get(nativePid);
  if (!observation.owner && owner) observation.owner = identity(owner);
  if (!observation.native && observation.owner && owner && same(owner, observation.owner) && native?.ppid === ownerPid) {
    observation.native = { ...identity(native), parent: identity(owner) };
  }
  const known = new Set([observation.native, ...observation.descendants].filter(value => value !== null).map(key));
  const parents = [observation.native, ...observation.descendants].filter(value => value && processState(value, table) === 'running') as ProcessIdentity[];
  for (let index = 0; index < parents.length; index++) {
    const parent = parents[index]!;
    for (const child of table.values()) {
      if (child.ppid !== parent.pid || child.state.startsWith('Z') || known.has(key(child))) continue;
      if (observation.descendants.length >= MAX_OBSERVED_DESCENDANTS) { observation.truncated = true; continue; }
      observation.descendants.push({ ...identity(child), parent: identity(parent) }); known.add(key(child)); parents.push(child);
    }
  }
  observation.observedAt = Date.now(); observation.available = true;
}

export function parseProcessObservation(input: unknown, binding: string): ProcessObservation {
  const value = record(input);
  const validIdentity = (input: unknown): input is ProcessIdentity => {
    const row = record(input);
    return Number.isSafeInteger(row.pid) && Number(row.pid) > 0 && typeof row.started === 'string' && row.started.length <= 80 &&
      /^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/.test(row.started);
  };
  if (value.version !== 1 || value.binding !== binding || !Number.isSafeInteger(value.observedAt) || Number(value.observedAt) < 0 ||
    !Number.isFinite(new Date(Number(value.observedAt)).getTime()) ||
    typeof value.available !== 'boolean' || (value.available && value.observedAt === 0) || typeof value.truncated !== 'boolean' ||
    (value.owner !== null && !validIdentity(value.owner)) || !Array.isArray(value.descendants) || value.descendants.length > MAX_OBSERVED_DESCENDANTS) throw new Error('Invalid process observation');
  const native = value.native === null ? null : record(value.native);
  const nativeParent = native?.parent;
  if (native && (!validIdentity(native) || !validIdentity(nativeParent) || !value.owner || same(native, value.owner as ProcessIdentity) || !same(nativeParent, value.owner as ProcessIdentity))) throw new Error('Invalid native process edge');
  const known = new Set(native ? [key(native as RegisteredProcess)] : []);
  for (const item of value.descendants) {
    const child = record(item), parent = child.parent;
    if (!validIdentity(child) || !validIdentity(parent) || !known.has(key(parent)) || known.has(key(child)) || (value.owner !== null && same(child, value.owner as ProcessIdentity))) throw new Error('Invalid descendant process edge');
    known.add(key(child));
  }
  return value as unknown as ProcessObservation;
}

export class ProcessObserver {
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private disabled = false;
  private stopped = false;
  private closing?: Promise<void>;
  private observation: ProcessObservation;
  constructor(private path: string, binding: string, private ownerPid: number, private nativePid: number,
    private read: () => Promise<ProcessTable> = readProcessTable) {
    this.observation = { version: 1, binding, observedAt: 0, available: false, truncated: false, owner: null, native: null, descendants: [] };
  }
  private sample(): Promise<void> {
    if (this.disabled) return Promise.resolve();
    return this.work ??= (async () => {
      try { registerProcesses(this.observation, this.ownerPid, this.nativePid, await this.read()); }
      catch { this.observation.available = false; }
      try { writePrivate(this.path, this.observation); }
      catch { this.disabled = true; clearInterval(this.timer); }
    })().finally(() => { this.work = undefined; });
  }
  async start(): Promise<void> {
    await this.sample();
    if (!this.disabled && !this.stopped) { this.timer = setInterval(() => { if (!this.stopped) void this.sample(); }, 1000); this.timer.unref(); }
  }
  stop(): Promise<void> {
    return this.closing ??= (async () => { this.stopped = true; clearInterval(this.timer); await this.work; await this.sample(); })();
  }
}
