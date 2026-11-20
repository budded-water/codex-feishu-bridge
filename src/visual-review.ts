import { record, type IncomingMessage } from './types.js';
import type { VisualReviewBinding, VisualOperationResult } from './handoff/visual-review-workflow.js';

export type VisualDecision = 'accept' | 'merge' | 'upload';
export type VisualPhase = 'pending' | 'reviewed' | 'merge-queued' | 'merging' | 'merge-blocked' | 'merge-unknown' |
  'merged' | 'upload-queued' | 'uploading' | 'upload-blocked' | 'upload-unknown' | 'uploaded';

export interface VisualReviewView {
  id: string;
  binding: VisualReviewBinding;
  phase: VisualPhase;
  mergeCommit?: string;
  result?: VisualOperationResult;
}

export interface VisualReviewClick extends Pick<IncomingMessage, 'tenant' | 'user' | 'chat'> {
  message: string;
  id: string;
  decision: VisualDecision;
}

export interface VisualAttachment { caption: string; key: string }

export function normalizeVisualReviewClick(input: unknown, appId: string): VisualReviewClick | undefined {
  const event = record(input), operator = record(event.operator), context = record(event.context), action = record(event.action);
  const { id, decision, kind } = record(action.value);
  if (event.schema !== '2.0' || event.app_id !== appId || event.host !== 'im_message' ||
    typeof event.tenant_key !== 'string' || event.tenant_key !== operator.tenant_key ||
    typeof operator.open_id !== 'string' || !/^ou_[\w-]+$/.test(operator.open_id) ||
    typeof context.open_chat_id !== 'string' || typeof context.open_message_id !== 'string' ||
    !/^om_[\w-]+$/.test(context.open_message_id) || action.tag !== 'button' || kind !== 'visual_review' ||
    typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) ||
    (decision !== 'accept' && decision !== 'merge' && decision !== 'upload')) return;
  return { id, decision, message: context.open_message_id, tenant: event.tenant_key, user: operator.open_id, chat: context.open_chat_id };
}
