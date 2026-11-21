import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { record } from '../types.js';

export const fullCommit = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const targetName = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const runFile = promisify(execFile);

export interface VisualWorkflow { executable: string; sha256: string; base: string; uploadTarget?: string }
export type VisualWorkflows = Record<string, VisualWorkflow>;
export interface VisualReviewBinding {
  repository: string;
  commit: string;
  pullRequest?: number;
  workflow?: VisualWorkflow;
}
export interface VisualOperation {
  id: string;
  action: 'merge' | 'upload';
  binding: VisualReviewBinding;
  mergeCommit?: string;
}
export type VisualOperationResult =
  | { status: 'blocked'; reason: 'stale-source' | 'checks' | 'authorization' | 'target-unavailable' | 'workflow-unavailable' | 'effect-absent' }
  | { status: 'merged'; mergeCommit: string }
  | { status: 'uploaded'; version: string; receipt: string };

export function githubRepository(origin: string): string | undefined {
  return /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(origin)?.[1]?.toLowerCase();
}

export function visualWorkflows(value: unknown): VisualWorkflows {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid visual review workflows');
  const entries = Object.entries(value).map(([repo, raw]) => {
    const { executable, sha256: hash, base, uploadTarget } = record(raw);
    if (githubRepository('https://github.com/' + repo) !== repo ||
      typeof executable !== 'string' || !isAbsolute(executable) ||
      typeof hash !== 'string' || !sha256.test(hash) ||
      typeof base !== 'string' || !targetName.test(base) ||
      (uploadTarget !== undefined && (typeof uploadTarget !== 'string' || !targetName.test(uploadTarget)))) {
      throw Error('Invalid visual review workflow');
    }
    return [repo, { executable, sha256: hash, base, uploadTarget }];
  });
  return Object.fromEntries(entries) as VisualWorkflows;
}

function matchesWorkflow(pinned: VisualWorkflow, current?: VisualWorkflow) {
  return current?.executable === pinned.executable && current.sha256 === pinned.sha256 && current.base === pinned.base &&
    current.uploadTarget === pinned.uploadTarget;
}

function protectedParents(executable: string, uid: number): boolean {
  let directory = dirname(executable);
  for (;;) {
    const info = lstatSync(directory);
    if (!info.isDirectory() || (info.uid !== uid && info.uid !== 0) ||
        ((info.mode & 0o022) !== 0 && (info.mode & 0o1000) === 0)) return false;
    const parent = dirname(directory);
    if (directory === parent) return true;
    directory = parent;
  }
}

export async function executeVisualOperation(operation: VisualOperation, workflows: VisualWorkflows,
  timeout = 20 * 60_000): Promise<VisualOperationResult> {
  const { binding, action, mergeCommit, id } = operation;
  const { repository, commit, pullRequest, workflow } = binding;
  if (!workflow || !pullRequest || !matchesWorkflow(workflow, workflows[repository]) ||
      (action === 'upload' && (!workflow.uploadTarget || !mergeCommit))) return { status: 'blocked', reason: 'workflow-unavailable' };
  const executable = workflow.executable;
  try {
    const file = lstatSync(executable);
    if (!file.isFile() || realpathSync(executable) !== executable || file.uid !== process.getuid?.() ||
        (file.mode & 0o022) !== 0 || file.size > 2 * 1024 * 1024 ||
        !protectedParents(executable, file.uid) ||
        createHash('sha256').update(readFileSync(executable)).digest('hex') !== workflow.sha256) {
      return { status: 'blocked', reason: 'workflow-unavailable' };
    }
  } catch { return { status: 'blocked', reason: 'workflow-unavailable' }; }

  // The configured project workflow owns the repository checks and actual provider receipts.
  const payload = { id, action, repository, commit, pullRequest, base: workflow.base,
    ...(action === 'upload' && { mergeCommit, target: workflow.uploadTarget }) };
  const { PATH, HOME, LANG, TMPDIR } = process.env;
  const { stdout } = await runFile(executable, [JSON.stringify(payload)], {
    env: { PATH, HOME, LANG, TMPDIR }, timeout, killSignal: 'SIGKILL', maxBuffer: 32 * 1024,
  });
  const result = record(JSON.parse(stdout));
  if (result.id !== id || result.action !== action || result.repository !== repository ||
      result.commit !== commit || result.pullRequest !== pullRequest || result.base !== workflow.base ||
      (action === 'upload' && (result.mergeCommit !== mergeCommit || result.target !== workflow.uploadTarget))) {
    throw Error('Visual workflow receipt identity differs');
  }
  const reason = result.reason;
  if (result.status === 'blocked' &&
    (reason === 'stale-source' || reason === 'checks' || reason === 'authorization' || reason === 'target-unavailable')) {
    return { status: 'blocked', reason };
  }
  const confirmed = confirmedVisualResult(action, result);
  if (confirmed) return confirmed;
  throw Error('Visual workflow did not confirm its result');
}

export function inspectedVisualResult(action: VisualOperation['action'], value: ReturnType<typeof record>): VisualOperationResult {
  if (value.status === 'absent') return { status: 'blocked', reason: 'effect-absent' };
  const confirmed = confirmedVisualResult(action, value);
  if (!confirmed) throw Error('Invalid inspected visual result');
  return confirmed;
}

function confirmedVisualResult(action: VisualOperation['action'], value: ReturnType<typeof record>): VisualOperationResult | undefined {
  if (action === 'merge' && value.status === 'merged' && typeof value.mergeCommit === 'string' && fullCommit.test(value.mergeCommit)) {
    return { status: 'merged', mergeCommit: value.mergeCommit };
  }
  if (action === 'upload' && value.status === 'uploaded' && typeof value.version === 'string' && targetName.test(value.version) &&
      typeof value.receipt === 'string' && targetName.test(value.receipt)) {
    return { status: 'uploaded', version: value.version, receipt: value.receipt };
  }
}

export function readVisualInspection(path: string) {
  if (!isAbsolute(path)) throw Error('Visual inspection requires an absolute path');
  const handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const file = fstatSync(handle);
    if (!file.isFile() || file.uid !== process.getuid?.() || (file.mode & 0o077) !== 0 || file.size > 16 * 1024) {
      throw Error('Visual inspection must be private to the runtime owner');
    }
    return record(JSON.parse(readFileSync(handle, 'utf8')));
  } finally { closeSync(handle); }
}
