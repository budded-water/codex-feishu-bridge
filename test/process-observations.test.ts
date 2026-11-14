import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProcessObserver, registerProcesses, parseProcessObservation, processState, readProcessTable,
  MAX_OBSERVED_DESCENDANTS, type ProcessObservation, type ProcessTable } from '../src/handoff/processes.js';

const started = 'Sat Nov 14 10:00:00 2026';
const row = (pid: number, ppid: number, state = 'S') => ({ pid, ppid, state, started });
const empty = (): ProcessObservation => ({ version: 1, binding: 'fixture-binding', observedAt: 0, available: false, truncated: false, owner: null, native: null, descendants: [] });

test('actual OS observations retain an orphaned registered child and exclude unrelated owner children', async t => {
  const root = spawn(process.execPath, ['test/fixtures/process-tree.mjs', 'root'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const sibling = spawn(process.execPath, ['test/fixtures/process-tree.mjs', 'leaf'], { detached: true, stdio: 'ignore' });
  t.after(() => { for (const child of [root, sibling]) { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} } });
  const [chunk] = await once(root.stdout!, 'data'); const leaf = JSON.parse(String(chunk)).child as number;
  const observation = empty(), first = await readProcessTable();
  registerProcesses(observation, process.pid, root.pid!, first);
  assert.equal(observation.native!.pid, root.pid); assert.ok(observation.descendants.some(value => value.pid === leaf));
  assert.ok(!observation.descendants.some(value => value.pid === sibling.pid));
  const exited = once(root, 'exit'); root.kill('SIGKILL'); await exited;
  const second = await readProcessTable(); registerProcesses(observation, process.pid, root.pid!, second);
  assert.equal(processState(observation.native, second), 'exited');
  assert.equal(processState(observation.descendants.find(value => value.pid === leaf)!, second), 'running');
  assert.deepEqual(parseProcessObservation(JSON.parse(JSON.stringify(observation)), 'fixture-binding'), observation);
});

test('changed PID identity, zombies and unavailable OS observations remain distinct', () => {
  const identity = { pid: 3, started };
  assert.equal(processState(identity, new Map([[3, { ...row(3, 2), started: 'Sat Nov 14 10:00:01 2026' }]])), 'unverified');
  assert.equal(processState(identity, new Map([[3, row(3, 2, 'Z')]])), 'exited');
  assert.equal(processState(identity, new Map(), () => false), 'exited'); assert.equal(processState(identity, null), 'unverified');
  assert.equal(processState(identity, new Map(), () => true), 'unverified');
  assert.equal(processState(identity, new Map(), () => null), 'unverified');
  assert.equal(processState(null, new Map()), 'unverified');
});

test('registry bounds observed descendants and rejects cross-binding, malformed and disconnected metadata', () => {
  const observation = empty(); const table: ProcessTable = new Map([[1, row(1, 0)], [2, row(2, 1)]]);
  for (let pid = 3; pid < MAX_OBSERVED_DESCENDANTS + 9; pid++) table.set(pid, row(pid, 2));
  registerProcesses(observation, 1, 2, table);
  assert.equal(observation.descendants.length, MAX_OBSERVED_DESCENDANTS); assert.equal(observation.truncated, true);
  assert.throws(() => parseProcessObservation(observation, 'another-binding'));
  for (const changed of [
    { ...observation, observedAt: Number.MAX_SAFE_INTEGER },
    { ...observation, descendants: [...observation.descendants, observation.descendants[0]!] },
    { ...observation, native: { ...observation.native!, parent: { pid: 999, started } } },
    { ...observation, descendants: [{ pid: 3, started, parent: { pid: 999, started } }] },
    { ...observation, descendants: [{ pid: 1, started, parent: { pid: 2, started } }] },
    { ...observation, native: { pid: 1, started, parent: { pid: 1, started } } },
  ]) assert.throws(() => parseProcessObservation(changed, 'fixture-binding'));
});

test('observer closes atomically through an in-flight sample and never resumes after closure', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'process-observation-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  let release!: () => void, calls = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const table: ProcessTable = new Map([[1, row(1, 0)], [2, row(2, 1)], [3, row(3, 2)]]);
  const path = join(folder, 'native-processes.json');
  const observer = new ProcessObserver(path, 'fixture-binding', 1, 2, async () => { calls++; if (calls === 1) await gate; return table; });
  t.mock.timers.enable({ apis: ['setInterval'] });
  const starting = observer.start(); const closing = observer.stop(); release(); await Promise.all([starting, closing]);
  const saved = readFileSync(path, 'utf8'); const parsed = parseProcessObservation(JSON.parse(saved), 'fixture-binding');
  assert.equal(parsed.descendants.length, 1); assert.equal(statSync(path).mode & 0o777, 0o600);
  t.mock.timers.tick(5000);
  await observer.stop(); assert.equal(calls, 2); assert.equal(readFileSync(path, 'utf8'), saved);
});

test('failed process sampling produces unavailable evidence without failing execution lifecycle', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'process-unavailable-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'native-processes.json'); const observer = new ProcessObserver(path, 'fixture-binding', 1, 2, async () => { throw new Error('ps unavailable'); });
  await observer.start(); await observer.stop(); const parsed = parseProcessObservation(JSON.parse(readFileSync(path, 'utf8')), 'fixture-binding');
  assert.equal(parsed.available, false); assert.equal(parsed.native, null); assert.equal(parsed.observedAt, 0);
});
