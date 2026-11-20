import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { record } from '../types.js';

export interface VerificationProfile {
  projectRoot: string; projectId: string; suite: string; engineRoot: string; engineRevision: string;
  cliHash: string; libraryHash: string; timeoutMs: number;
  policyFiles: Record<string, string>;
  repair?: { scenarios: string[]; timeoutMs: number };
}
export type VerificationProfiles = Readonly<Record<string, VerificationProfile>>;
export const fingerprint = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const profileDigest = (value: VerificationProfile) => fingerprint(JSON.stringify(Object.fromEntries(Object.entries({ ...value,
  policyFiles: Object.fromEntries(Object.entries(value.policyFiles).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));

export function verificationProfiles(input: unknown): VerificationProfiles {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid verification profiles');
  const profiles: Record<string, VerificationProfile> = Object.create(null);
  for (const [name, value] of Object.entries(record(input))) {
    const p = record(value);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || Object.keys(p).filter(key => key !== 'repair').sort().join(',') !==
      'cliHash,engineRevision,engineRoot,libraryHash,policyFiles,projectId,projectRoot,suite,timeoutMs' ||
      typeof p.projectId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(p.projectId) ||
      typeof p.suite !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.suite) ||
      typeof p.engineRevision !== 'string' || !/^[0-9a-f]{40}$/.test(p.engineRevision) ||
      ![p.cliHash, p.libraryHash].every(x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) ||
      !Number.isSafeInteger(p.timeoutMs) || Number(p.timeoutMs) < 1000 || Number(p.timeoutMs) > 7_200_000) throw new Error('Invalid verification profile');
    const directory = (path: unknown) => {
      if (typeof path !== 'string' || !isAbsolute(path) || !lstatSync(path).isDirectory()) throw new Error('Invalid verification directory');
      return realpathSync(path);
    };
    if (!p.policyFiles || typeof p.policyFiles !== 'object' || Array.isArray(p.policyFiles)) throw new Error('Missing trusted verification policy');
    const policyFiles: Record<string, string> = Object.create(null);
    for (const [path, hash] of Object.entries(p.policyFiles)) {
      if (isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..') ||
        typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid trusted verification policy');
      policyFiles[path] = hash;
    }
    for (const required of ['ui-eval/project.json', 'ui-eval/engine.json', `ui-eval/integrations/${p.suite}.json`]) {
      if (!Object.hasOwn(policyFiles, required)) throw new Error('Missing required verification policy file');
    }
    let repair: VerificationProfile['repair'];
    if (p.repair !== undefined) {
      const r = record(p.repair);
      if (Object.keys(r).sort().join(',') !== 'scenarios,timeoutMs' || !Array.isArray(r.scenarios) || !r.scenarios.length || r.scenarios.length > 32 ||
        r.scenarios.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) || new Set(r.scenarios).size !== r.scenarios.length ||
        !Number.isSafeInteger(r.timeoutMs) || Number(r.timeoutMs) < 1000 || Number(r.timeoutMs) > 7_200_000) throw new Error('Invalid repair policy');
      repair = { scenarios: r.scenarios as string[], timeoutMs: Number(r.timeoutMs) };
    }
    profiles[name] = { projectRoot: directory(p.projectRoot), projectId: p.projectId, suite: p.suite,
      engineRoot: directory(p.engineRoot), engineRevision: p.engineRevision, cliHash: String(p.cliHash),
      libraryHash: String(p.libraryHash), timeoutMs: Number(p.timeoutMs), policyFiles, ...(repair ? { repair } : {}) };
  }
  return profiles;
}

export function boundedFile(root: string, path: string, limit = 8 * 1024 * 1024): Buffer {
  const child = relative(root, path);
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child) || realpathSync(root) !== root) throw new Error('Foreign verification artifact');
  let current = root;
  for (const part of child.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Linked verification artifact');
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > limit) throw new Error('Invalid verification artifact');
  const data = readFileSync(path);
  if (data.length > limit) throw new Error('Verification artifact exceeded limit');
  return data;
}

const exec = promisify(execFile);
export function verificationEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:HANDOFF_|AGENT_AUTOLOOP_|FEISHU_|BRIDGE_)/i.test(name)));
}

export async function gitRead(root: string, args: string[]): Promise<string> {
  return (await exec('git', ['--no-optional-locks', '-C', root, ...args], { timeout: 5000, maxBuffer: 1024 * 1024, env: verificationEnvironment() })).stdout.trim();
}

export async function verificationSourceState(root: string): Promise<{ commit: string; clean: boolean }> {
  const initialCommit = await gitRead(root, ['rev-parse', 'HEAD']);
  const submodules = await gitRead(root, ['submodule', 'status', '--recursive']);
  const nested = submodules && await gitRead(root, ['submodule', 'foreach', '--quiet', '--recursive',
    'git --no-optional-locks status --porcelain=v2 --untracked-files=all --ignore-submodules=none']);
  // Take the root snapshot after the potentially slower recursive scan.
  const status = (await gitRead(root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '--ignore-submodules=none'])).split('\n');
  const commit = status.find(line => line.startsWith('# branch.oid '))?.slice('# branch.oid '.length);
  if (!commit || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Verification source commit unavailable');
  return { commit, clean: commit === initialCommit && !nested &&
    !/^[-+U][a-f0-9]+ /m.test(submodules) && status.every(line => line.startsWith('# ')) };
}

export async function verifyEngine(p: VerificationProfile): Promise<void> {
  if (await gitRead(p.engineRoot, ['rev-parse', '--show-toplevel']) !== p.engineRoot ||
    await gitRead(p.engineRoot, ['rev-parse', 'HEAD']) !== p.engineRevision ||
    await gitRead(p.engineRoot, ['status', '--porcelain', '--untracked-files=all']) ||
    fingerprint(boundedFile(p.engineRoot, join(p.engineRoot, 'dist/cli.js'))) !== p.cliHash ||
    fingerprint(boundedFile(p.engineRoot, join(p.engineRoot, 'dist/index.js'))) !== p.libraryHash) throw new Error('Verification engine changed');
}

export function verifyPolicy(p: VerificationProfile): void {
  for (const [path, hash] of Object.entries(p.policyFiles)) {
    if (fingerprint(boundedFile(p.projectRoot, join(p.projectRoot, path))) !== hash) throw new Error('Trusted verification policy changed');
  }
  const suite = record(JSON.parse(boundedFile(p.projectRoot, join(p.projectRoot, 'ui-eval/integrations', p.suite + '.json')).toString('utf8')));
  if (suite.adapter !== 'web' || suite.id !== p.suite || suite.projectId !== p.projectId ||
    (suite.verificationPlan !== undefined && (typeof suite.verificationPlan !== 'string' || !Object.hasOwn(p.policyFiles, suite.verificationPlan)))) {
    throw new Error('Unsupported or unpinned verification policy');
  }
}
