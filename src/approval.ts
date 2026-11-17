import type { RememberedCommand } from './permissions.js';
import type { Config } from './config.js';
import { randomUUID } from 'node:crypto';
import { deadline, fencedPreview } from './ux.js';
import { record, type IncomingMessage, type NativeControlTarget } from './types.js';

export type ApprovalView = 'pending' | 'approved' | 'rejected' | 'expired' | 'unavailable' | 'remembered';
export interface ApprovalPresentation {
  version: 1; id: string; prompt: string; task: string; tenant: string; chat: string;
  target: NativeControlTarget; expires: number; context: string; reason: string; action: string; sourceLink?: string; remember?: RememberedCommand;
}
export interface ApprovalClick { event: string; tenant: string; user: string; chat: string; message: string; id: string; decision: 'approve' | 'approve_save' | 'reject' }
export type CardResult = 'accepted' | 'duplicate' | 'rejected';
export const APPROVAL_CARD_BYTES = 24 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (value: unknown, size: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= size;
const escape = (text: string) => text.replace(/[\\`*_{}\[\]()<>!|]/g, '\\$&');

export function parseApproval(input: unknown): ApprovalPresentation {
  const p = record(input), target = record(p.target);
  if (p.version !== 1 || !bounded(p.id, 36) || !uuid.test(p.id) || typeof p.prompt !== 'string' || !/^[a-f0-9]{8}$/.test(p.prompt) ||
    !bounded(p.task, 200) || !bounded(p.tenant, 200) || !bounded(p.chat, 200) ||
    !['generation', 'thread', 'turn'].every(key => bounded(target[key], 200)) || !Number.isSafeInteger(p.expires) || !Number.isFinite(new Date(Number(p.expires)).getTime()) ||
    !bounded(p.context, 500) || !bounded(p.reason, APPROVAL_CARD_BYTES) || !bounded(p.action, APPROVAL_CARD_BYTES) ||
    (p.sourceLink !== undefined && (typeof p.sourceLink !== 'string' || p.sourceLink.length > 2000 || !/^https:\/\/(?:applink\.)?feishu\.cn\//.test(p.sourceLink)))) throw new Error('Invalid approval presentation');
  if (p.remember !== undefined) {
    const m = record(p.remember);
    if (typeof m.id !== 'string' || !uuid.test(m.id) || m.scope !== 'codex-user' || !Array.isArray(m.prefix) || m.prefix.length < 3 || m.prefix.length > 16 || m.prefix.some(x => !bounded(x, 1000))) throw Error('Invalid remembered rule presentation');
  }
  return p as unknown as ApprovalPresentation;
}

export function approvalPresentation(value: Omit<ApprovalPresentation, 'version' | 'id'>): ApprovalPresentation {
  return { version: 1, id: randomUUID(), ...value };
}

export function approvalText(p: Pick<ApprovalPresentation, 'context' | 'reason' | 'action' | 'prompt' | 'expires' | 'sourceLink' | 'remember'>): string {
  return `### 需要你确认\n\n**用途**\n${escape(p.reason)}\n\n**本次动作**\n${fencedPreview(p.action)}\n\n` +
    `${p.remember ? `**可记住的规则**\n${fencedPreview(JSON.stringify(p.remember.prefix))}\n影响共用此 Codex 用户配置的会话；允许此前缀的参数变化。\n\n` : ''}${escape(p.context)} · 请求 ${p.prompt} · 截止 ${deadline(p.expires)}\n${p.sourceLink ? `[查看原任务](${p.sourceLink})\n` : ''}` +
    `${p.remember ? '批准本次只授权当前动作；批准并记住会保存上述用户级前缀。' : '仅授权本次动作。'}过期不授权。\n\n\`/approve ${p.prompt}\`　\`/reject ${p.prompt}\`${p.remember ? `\n\`/approve-save ${p.prompt}\`` : ''}`;
}

export function approvalCard(p: ApprovalPresentation, view: ApprovalView = 'pending') {
  const title = { pending: '操作确认', approved: '批准已提交', rejected: '拒绝已提交', expired: '确认已过期', unavailable: '请求已失效', remembered: '批准与保存已提交' }[view];
  const markdown = (content: string) => ({ tag: 'markdown', content });
  const panel = (label: string, elements: unknown[]) => ({ tag: 'collapsible_panel', expanded: false,
    header: { title: { tag: 'plain_text', content: label } }, elements });
  const button = (decision: ApprovalClick['decision']) => ({ tag: 'button', width: 'fill', size: 'large',
    type: decision === 'approve' ? 'primary_filled' : decision === 'reject' ? 'danger' : 'default',
    text: { tag: 'plain_text', content: decision === 'approve' ? '批准本次' : decision === 'approve_save' ? '批准并记住' : '拒绝' },
    behaviors: [{ type: 'callback', value: { kind: 'codex_approval', id: p.id, decision } }] });
  const action = markdown(`**本次动作**\n${fencedPreview(p.action)}`);
  const rule: unknown[] = p.remember ? [markdown('**可记住的规则**'),
    { tag: 'div', text: { tag: 'plain_text', content: JSON.stringify(p.remember.prefix) } },
    markdown('**本机 Codex 用户级** · 允许此前缀的参数变化\n影响共用此配置的会话；不限定本任务或单个仓库。')] : [];
  const request = markdown(`请求编号：\`${p.prompt}\`${p.sourceLink ? `\n[查看原任务](${p.sourceLink})` : ''}`);
  const elements: unknown[] = [markdown(`**用途**\n${escape(p.reason)}`),
    { ...markdown(`${escape(p.context)} · 截止 ${deadline(p.expires)}`), text_size: 'notation' }];
  if (view === 'pending') {
    elements.push(action, markdown('仅授权本次动作；后续操作另行确认。'),
      { tag: 'column_set', horizontal_spacing: '8px', columns: (['approve', 'reject'] as const).map(decision => ({
        tag: 'column', width: 'weighted', weight: 1, elements: [button(decision)],
      })) });
    if (p.remember) elements.push({ tag: 'hr' }, ...rule,
      markdown('将同时批准本次动作，并保存上述前缀规则。'), button('approve_save'));
    elements.push(panel('备用命令与请求信息', [request,
      markdown(`按钮不可用时，发送对应命令：\n\`/approve ${p.prompt}\`\n\`/reject ${p.prompt}\`${p.remember ? `\n\`/approve-save ${p.prompt}\`` : ''}`)]));
  } else {
    elements.push(markdown(view === 'remembered' ? '本次批准与规则保存请求已提交；发送 /rules 核对实际保存结果。执行结果以任务回复为准。' : view === 'approved' || view === 'rejected' ? '本次决定已提交。执行结果以任务回复为准。' : '此卡片不再接受操作，请查看任务状态或发起新的请求。'),
      panel('查看本次动作与请求信息', [action, ...rule, request]));
  }
  return { schema: '2.0', config: { update_multi: true }, header: { title: { tag: 'plain_text', content: title },
    template: view === 'pending' ? 'orange' : view === 'approved' || view === 'remembered' ? 'green' : 'grey' },
    body: { padding: '12px', vertical_spacing: '8px', elements } };
}

// Called only on data produced by this app's authenticated SDK dispatcher.
export function normalizeApprovalClick(input: unknown, appId: string): ApprovalClick | undefined {
  const e = record(input), actor = record(e.operator), context = record(e.context), action = record(e.action), value = record(action.value);
  if (e.schema !== '2.0' || e.app_id !== appId || e.host !== 'im_message' || !bounded(e.event_id, 200) || !/^[a-zA-Z0-9_-]+$/.test(e.event_id) ||
    !bounded(e.tenant_key, 200) || actor.tenant_key !== e.tenant_key || !bounded(actor.open_id, 200) || !/^ou_[\w-]+$/.test(actor.open_id) ||
    !bounded(context.open_chat_id, 200) || !bounded(context.open_message_id, 200) || action.tag !== 'button' || value.kind !== 'codex_approval' ||
    typeof value.id !== 'string' || !uuid.test(value.id) || !['approve', 'approve_save', 'reject'].includes(String(value.decision))) return;
  return { event: e.event_id, tenant: e.tenant_key, user: actor.open_id, chat: context.open_chat_id, message: context.open_message_id,
    id: value.id, decision: value.decision as ApprovalClick['decision'] };
}

export function cardMessage(click: ApprovalClick, p: ApprovalPresentation): IncomingMessage {
  return { tenant: click.tenant, user: click.user, chat: click.chat, id: 'card/' + click.event, parentId: click.message,
    chatType: 'p2p', text: '/' + (click.decision === 'approve_save' ? 'approve-save' : click.decision) + ' ' + p.prompt };
}

export function approvalReplyTarget(message: IncomingMessage): string | undefined {
  return message.id.startsWith('card/') ? message.parentId : message.id;
}

export function approvalActorAllowed(config: Config, click: ApprovalClick): boolean {
  return (!config.allowedTenant || config.allowedTenant === click.tenant) && config.approvalUsers.includes(click.user) &&
    (!config.approvalChat || config.approvalChat === click.chat) &&
    (config.accessMode !== 'allowlist' || config.allowedUsers.includes(click.user));
}
