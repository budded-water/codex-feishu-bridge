import { record } from './types.js';

export interface TaskPresentation { id: string; execution: string; tenant: string; user: string; chat: string; text: string }
export interface TaskRefreshClick { kind: 'task-refresh'; event: string; tenant: string; user: string; chat: string; message: string; id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function parseTaskPresentation(input: unknown): TaskPresentation {
  const v = record(input);
  if (!bounded(v.id, 36) || !uuid.test(v.id) || !bounded(v.execution, 36) || !uuid.test(v.execution) ||
    !['tenant', 'user', 'chat'].every(k => bounded(v[k], 200)) || !bounded(v.text, 20_000) ||
    Buffer.byteLength(JSON.stringify(taskCard(v as unknown as TaskPresentation))) > 24 * 1024) throw new Error('Invalid task presentation');
  return v as unknown as TaskPresentation;
}

export function taskCard(p: TaskPresentation) {
  return { schema: '2.0', config: { update_multi: true }, header: { title: { tag: 'plain_text', content: '任务进度' }, template: 'blue' },
    body: { padding: '12px', vertical_spacing: '12px', elements: [{ tag: 'markdown', content: p.text.replace(/^### (.+)\n\n/, '**$1**\n\n') }, { tag: 'hr' },
      { tag: 'button', type: 'default', text: { tag: 'plain_text', content: '刷新进度' },
        behaviors: [{ type: 'callback', value: { kind: 'task_progress', id: p.id } }] }] } };
}

// The existing authenticated SDK dispatcher is the only caller of this boundary.
export function normalizeTaskRefresh(input: unknown, appId: string): TaskRefreshClick | undefined {
  const e = record(input), actor = record(e.operator), context = record(e.context), action = record(e.action), value = record(action.value);
  if (e.schema !== '2.0' || e.app_id !== appId || e.host !== 'im_message' || !bounded(e.event_id, 200) || !/^[a-zA-Z0-9_-]+$/.test(e.event_id) ||
    !bounded(e.tenant_key, 200) || actor.tenant_key !== e.tenant_key || !bounded(actor.open_id, 200) || !/^ou_[\w-]+$/.test(actor.open_id) ||
    !bounded(context.open_chat_id, 200) || !bounded(context.open_message_id, 200) || action.tag !== 'button' || value.kind !== 'task_progress' ||
    !bounded(value.id, 36) || !uuid.test(value.id)) return;
  return { kind: 'task-refresh', event: e.event_id, tenant: e.tenant_key, user: actor.open_id, chat: context.open_chat_id, message: context.open_message_id, id: value.id };
}
