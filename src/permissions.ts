import { isAbsolute } from 'node:path';
import { record } from './types.js';
import type { CommandExecutionRequestApprovalParams } from './codex/generated/v2/CommandExecutionRequestApprovalParams.js';
import type { CommandExecutionApprovalDecision } from './codex/generated/v2/CommandExecutionApprovalDecision.js';
import type { ItemGuardianApprovalReviewCompletedNotification } from './codex/generated/v2/ItemGuardianApprovalReviewCompletedNotification.js';

export interface NativePermissions {
  sandbox: 'read-only' | 'workspace-write';
  reviewer: 'user' | 'auto_review';
  rememberCommands: boolean;
}
export interface RememberedCommand { id: string; prefix: string[]; scope: 'codex-user' }
export type ReviewAction = { type: 'command'; source: 'shell' | 'unified_exec'; command: string; cwd: string } |
  { type: 'execve'; source: 'shell' | 'unified_exec'; program: string; argv: string[]; cwd: string };
export interface NativeReview {
  id: string; thread: string; turn: string; item: string | null; started: number; completed: number;
  status: 'approved' | 'denied' | 'timedOut' | 'aborted'; rationale: string; risk: string | null; authorization: string | null;
  action: ReviewAction | null;
}
const text = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export function nativePermissions(value: unknown): NativePermissions | undefined {
  if (value == null) return;
  const v = record(value);
  if (Object.keys(v).some(k => !['sandbox', 'reviewer', 'rememberCommands'].includes(k)) ||
    !['read-only', 'workspace-write'].includes(String(v.sandbox)) || !['user', 'auto_review'].includes(String(v.reviewer)) ||
    typeof v.rememberCommands !== 'boolean') throw Error('Invalid nativePermissions');
  return v as unknown as NativePermissions;
}
export function permissionParams(p: NativePermissions) {
  return { sandbox: p.sandbox, approvalPolicy: 'on-request' as const, approvalsReviewer: p.reviewer };
}

export function rememberProposal(params: Record<string, unknown>, redact: (s: string) => string): string[] | undefined {
  const p = params as unknown as CommandExecutionRequestApprovalParams, prefix = p.proposedExecpolicyAmendment;
  if (p.kind && p.kind !== 'command' || p.networkApprovalContext || !Array.isArray(prefix) || prefix.length < 3 || prefix.length > 16 ||
    prefix.some(x => !text(x, 1000) || redact(x) !== x) || JSON.stringify(prefix).length > 4000) return;
  // These are user-approved command prefixes, not repository-scoped API grants.
  if (prefix[0] !== 'gh' || !['pr view', 'pr list', 'run view', 'run list', 'repo view'].includes(prefix.slice(1, 3).join(' '))) return;
  const expected: CommandExecutionApprovalDecision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: prefix } };
  if (!Array.isArray(p.availableDecisions) || !p.availableDecisions.some(x => JSON.stringify(x) === JSON.stringify(expected))) return;
  return [...prefix];
}
export function parseNativeReview(value: Record<string, unknown>): NativeReview | undefined {
  const v = value as unknown as ItemGuardianApprovalReviewCompletedNotification, r = record(v.review), a = record(v.action);
  if (!text(v.reviewId) || !text(v.threadId) || !text(v.turnId) ||
    (v.targetItemId != null && !text(v.targetItemId)) || !Number.isSafeInteger(v.startedAtMs) || !Number.isSafeInteger(v.completedAtMs) ||
    v.startedAtMs < 0 || v.completedAtMs < v.startedAtMs || !['approved', 'denied', 'timedOut', 'aborted'].includes(String(r.status)) ||
    (r.rationale != null && !text(r.rationale, 24_000)) ||
    (r.riskLevel != null && !['low', 'medium', 'high', 'critical'].includes(String(r.riskLevel))) ||
    (r.userAuthorization != null && !['unknown', 'low', 'medium', 'high'].includes(String(r.userAuthorization)))) return;
  let action: ReviewAction | null = null;
  if (['shell', 'unifiedExec'].includes(String(a.source)) && text(a.cwd, 4000) && isAbsolute(a.cwd)) {
    const source = a.source === 'unifiedExec' ? 'unified_exec' : 'shell';
    if (a.type === 'command' && text(a.command, 24_000)) action = { type: 'command', source, command: a.command, cwd: a.cwd };
    if (a.type === 'execve' && text(a.program, 4000) && Array.isArray(a.argv) && a.argv.length <= 128 && a.argv.every(x => text(x, 4000))) {
      action = { type: 'execve', source, program: a.program, argv: a.argv as string[], cwd: a.cwd };
    }
  }
  return { id: v.reviewId, thread: v.threadId, turn: v.turnId, item: v.targetItemId ?? null, started: v.startedAtMs, completed: v.completedAtMs,
    status: r.status as NativeReview['status'], rationale: String(r.rationale ?? '原生审查未提供原因'), risk: r.riskLevel as string | null ?? null,
    authorization: r.userAuthorization as string | null ?? null, action };
}
export function deniedActionEvent(review: NativeReview) {
  if (review.status !== 'denied' || !review.action) throw Error('Only a concrete native denial can be authorized');
  return { id: review.id, target_item_id: review.item, turn_id: review.turn, started_at_ms: review.started, completed_at_ms: review.completed,
    status: 'denied', risk_level: review.risk, user_authorization: review.authorization, rationale: review.rationale, action: review.action };
}
export function reviewCommand(review: NativeReview, redact = (s: string) => s): string {
  if (review.action?.type === 'command') return `cwd: ${JSON.stringify(redact(review.action.cwd))}\n${redact(review.action.command)}`;
  if (review.action?.type === 'execve') return JSON.stringify({ program: redact(review.action.program), argv: review.action.argv.map(redact), cwd: redact(review.action.cwd) });
  return '此动作类型暂不支持远程重试';
}
