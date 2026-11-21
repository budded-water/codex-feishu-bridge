import { record } from './types.js';
import { message, section, escapeMarkdownText as escapeTaskMarkdown } from './presentation.js';

export { escapeTaskMarkdown };

export interface TaskLayout {
  title: string; heading: string; tone: 'blue' | 'green' | 'orange' | 'grey'; summary: string; updated: string;
  facts: { label: string; value: string }[];
  action?: string;
  panels: { title: string; text: string }[];
}
export interface TaskPresentation { id: string; execution: string; tenant: string; user: string; chat: string; text: string; layout?: TaskLayout }
export interface TaskRefreshClick { kind: 'task-refresh'; event: string; tenant: string; user: string; chat: string; message: string; id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bounded = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

export function taskText(layout: TaskLayout): string {
  return message(escapeTaskMarkdown(layout.title), `**${escapeTaskMarkdown(layout.heading)}**\n${layout.summary}`,
    ...layout.facts.map(f => `${escapeTaskMarkdown(f.label)}：${escapeTaskMarkdown(f.value)}`), section('需要你处理', layout.action ? [layout.action] : []),
    ...layout.panels.map(p => section(p.title, [p.text])), layout.updated);
}

// All rendered strings pass the transport's existing redaction boundary.
export function redactTaskPresentation(p: TaskPresentation, redact: (text: string) => string): TaskPresentation {
  if (!p.layout) return { ...p, text: redact(p.text) };
  const v = p.layout;
  const layout: TaskLayout = { ...v, title: redact(v.title), heading: redact(v.heading), summary: redact(v.summary), updated: redact(v.updated),
    ...(v.action !== undefined && { action: redact(v.action) }), facts: v.facts.map(f => ({ label: redact(f.label), value: redact(f.value) })),
    panels: v.panels.map(p => ({ title: redact(p.title), text: redact(p.text) })) };
  return { ...p, layout, text: taskText(layout) };
}

export function parseTaskPresentation(input: unknown): TaskPresentation {
  const v = record(input);
  if (v.layout !== undefined) {
    const l = record(v.layout);
    if (!bounded(l.title, 120) || !bounded(l.heading, 60) || !['blue', 'green', 'orange', 'grey'].includes(String(l.tone)) ||
      !bounded(l.summary, 2000) || !bounded(l.updated, 200) || (l.action !== undefined && !bounded(l.action, 4000)) ||
      !Array.isArray(l.facts) || l.facts.length > 4 || l.facts.some(f => !bounded(record(f).label, 60) || !bounded(record(f).value, 300)) ||
      !Array.isArray(l.panels) || l.panels.length > 5 || l.panels.some(p => !bounded(record(p).title, 100) || !bounded(record(p).text, 16_000))) throw new Error('Invalid task layout');
    if (v.text !== taskText(l as unknown as TaskLayout)) throw new Error('Task layout text differs');
  }
  if (!bounded(v.id, 36) || !uuid.test(v.id) || !bounded(v.execution, 36) || !uuid.test(v.execution) ||
    !['tenant', 'user', 'chat'].every(k => bounded(v[k], 200)) || !bounded(v.text, 20_000) ||
    Buffer.byteLength(JSON.stringify(taskCard(v as unknown as TaskPresentation))) > 24 * 1024) throw new Error('Invalid task presentation');
  return v as unknown as TaskPresentation;
}

export function taskCard(p: TaskPresentation) {
  const l = p.layout;
  if (l) {
    const markdown = (content: string) => ({ tag: 'markdown', content });
    return { schema: '2.0', config: { update_multi: true }, header: { title: { tag: 'plain_text', content: l.heading }, template: l.tone },
      body: { padding: '12px', vertical_spacing: '8px', elements: [markdown(`**${escapeTaskMarkdown(l.title)}**`), markdown(l.summary),
        ...(l.facts.length ? [{ tag: 'column_set', horizontal_spacing: '8px', columns: l.facts.map(f => ({ tag: 'column', width: 'weighted', weight: 1,
          elements: [markdown(`${escapeTaskMarkdown(f.label)}\n**${escapeTaskMarkdown(f.value)}**`)] })) }] : []),
        ...(l.action ? [markdown(`**需要你处理**\n${l.action}`)] : []),
        { ...markdown(l.updated), text_size: 'notation' },
        { tag: 'button', type: 'default', width: 'fill', size: 'large', text: { tag: 'plain_text', content: '刷新进度' },
          behaviors: [{ type: 'callback', value: { kind: 'task_progress', id: p.id } }] },
        { tag: 'hr' }, { ...markdown('点击下方条目展开 / 收起详情'), text_size: 'notation' },
        ...l.panels.map(panel => ({ tag: 'collapsible_panel', expanded: false,
          header: { title: { tag: 'markdown', content: `<font color='blue'>**${escapeTaskMarkdown(panel.title)}**</font>` }, padding: '12px', vertical_align: 'center',
            icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined', color: 'blue', size: '20px 20px' }, icon_position: 'right', icon_expanded_angle: -180 },
          border: { color: 'grey', corner_radius: '8px' }, padding: '12px', elements: [markdown(panel.text)] })),
      ] } };
  }
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
