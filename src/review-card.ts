import { record, type IncomingMessage } from './types.js';
import type { CardResult } from './approval.js';

export interface ReviewPresentation {
  id: string; review: string; tenant: string; user: string; chat: string; text: string;
  retry: boolean; expires: number; consumed?: boolean;
}
export interface ReviewClick { event: string; id: string; tenant: string; user: string; chat: string; message: string }
export type ReviewHandler = (click: ReviewClick) => CardResult;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function parseReviewPresentation(input: unknown): ReviewPresentation {
  const v = record(input);
  if (!bounded(v.id, 36) || !uuid.test(v.id) || !bounded(v.review, 36) || !uuid.test(v.review) ||
    !['tenant', 'user', 'chat'].every(k => bounded(v[k], 200)) || !bounded(v.text, 18_000) || typeof v.retry !== 'boolean' ||
    !Number.isSafeInteger(v.expires) || Number(v.expires) <= 0 || (v.consumed != null && typeof v.consumed !== 'boolean') ||
    Buffer.byteLength(JSON.stringify(reviewCard(v as unknown as ReviewPresentation))) > 24 * 1024) throw Error('Invalid native review presentation');
  return v as unknown as ReviewPresentation;
}

export function reviewCard(p: ReviewPresentation) {
  return { schema: '2.0', config: { update_multi: true }, header: { title: { tag: 'plain_text', content: '原生权限审查' }, template: 'orange' },
    body: { padding: '12px', vertical_spacing: '12px', elements: [
      { tag: 'markdown', content: p.text.replace(/^### (.+)\n\n/, '**$1**\n\n') },
      ...(p.retry && !p.consumed ? [{ tag: 'hr' }, { tag: 'button', type: 'default',
        text: { tag: 'plain_text', content: '授权此动作，发起一次重试' },
        confirm: { title: { tag: 'plain_text', content: '单次授权' }, text: { tag: 'plain_text', content: '将新建任务，并由 Codex 重新审查。不会保存长期规则，也不保证获准或完成。' } },
        behaviors: [{ type: 'callback', value: { kind: 'codex_review_retry', id: p.id } }] }] : []),
    ] } };
}

// Only the authenticated SDK dispatcher may supply this platform event.
export function normalizeReviewClick(input: unknown, appId: string): ReviewClick | undefined {
  const e = record(input), actor = record(e.operator), context = record(e.context), action = record(e.action), value = record(action.value);
  if (e.schema !== '2.0' || e.app_id !== appId || e.host !== 'im_message' || !bounded(e.event_id, 200) || !/^[a-zA-Z0-9_-]+$/.test(e.event_id) ||
    !bounded(e.tenant_key, 200) || actor.tenant_key !== e.tenant_key || !bounded(actor.open_id, 200) || !/^ou_[\w-]+$/.test(actor.open_id) ||
    !bounded(context.open_chat_id, 200) || !bounded(context.open_message_id, 200) || action.tag !== 'button' || value.kind !== 'codex_review_retry' ||
    !bounded(value.id, 36) || !uuid.test(value.id)) return;
  return { event: e.event_id, id: value.id, tenant: e.tenant_key, user: actor.open_id, chat: context.open_chat_id, message: context.open_message_id };
}

export function reviewRetryMessage(click: ReviewClick, review: string): IncomingMessage {
  return { id: 'permission-retry/' + click.event, parentId: click.message, tenant: click.tenant, user: click.user,
    chat: click.chat, chatType: 'p2p', text: '/review-retry ' + review };
}
