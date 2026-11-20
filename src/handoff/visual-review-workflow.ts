import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
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
  | { status: 'blocked'; reason: 'stale-source' | 'checks' | 'authorization' | 'target-unavailable' | 'workflow-unavailable' }
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

export async function executeVisualOperation(operation: VisualOperation, workflows: VisualWorkflows): Promise<VisualOperationResult> {
  const { binding, action, mergeCommit, id } = operation;
  const { repository, commit, pullRequest, workflow } = binding;
  if (!workflow || !pullRequest || !matchesWorkflow(workflow, workflows[repository]) ||
      (action === 'upload' && (!workflow.uploadTarget || !mergeCommit))) return { status: 'blocked', reason: 'workflow-unavailable' };
  const executable = workflow.executable;
  try {
    const file = lstatSync(executable);
    if (!file.isFile() || realpathSync(executable) !== executable || file.uid !== process.getuid?.() ||
        (file.mode & 0o022) !== 0 || file.size > 2 * 1024 * 1024 ||
        createHash('sha256').update(readFileSync(executable)).digest('hex') !== workflow.sha256) {
      return { status: 'blocked', reason: 'workflow-unavailable' };
    }
  } catch { return { status: 'blocked', reason: 'workflow-unavailable' }; }

  // The configured project workflow owns the repository checks and actual provider receipts.
  const payload = { id, action, repository, commit, pullRequest, base: workflow.base,
    ...(action === 'upload' && { mergeCommit, target: workflow.uploadTarget }) };
  const { PATH, HOME, LANG, TMPDIR } = process.env;
  const { stdout } = await runFile(executable, [JSON.stringify(payload)], {
    env: { PATH, HOME, LANG, TMPDIR }, timeout: 20 * 60_000, maxBuffer: 32 * 1024,
  });
  const result = record(JSON.parse(stdout));
  if (result.id !== id || result.action !== action || result.repository !== repository ||
      result.commit !== commit || result.pullRequest !== pullRequest || result.base !== workflow.base) throw Error('Visual workflow receipt identity differs');
  if (result.status === 'blocked' &&
    ['stale-source','checks','authorization','target-unavailable'].includes(String(result.reason))) {
    return { status: 'blocked', reason: result.reason as Extract<VisualOperationResult, { status: 'blocked' }>['reason'] };
  }
  if (action === 'merge' && result.status === 'merged' && typeof result.mergeCommit === 'string' && fullCommit.test(result.mergeCommit)) {
    return { status: 'merged', mergeCommit: result.mergeCommit };
  }
  if (action === 'upload' && result.status === 'uploaded' && result.mergeCommit === mergeCommit &&
    result.target === workflow.uploadTarget && typeof result.version === 'string' && targetName.test(result.version) &&
    typeof result.receipt === 'string' && targetName.test(result.receipt)) {
    return { status: 'uploaded', version: result.version, receipt: result.receipt };
  }
  throw Error('Visual workflow did not confirm its result');
}
