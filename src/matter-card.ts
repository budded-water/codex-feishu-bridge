import { record } from './types.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const target = (v: unknown): v is string => typeof v === 'string' && (v === 'default' || uuid.test(v));
const bounded = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n;

export interface MatterPresentation {
  id: string; tenant: string; user: string; chat: string;
  title: string; text: string; action: 'switch' | 'route';
  choices: { id: string; label: string }[];
  anchor?: string;
}
export interface MatterClick {
  id: string; event: string; tenant: string; user: string; chat: string; message: string; choice: string;
}

export function parseMatterPresentation(input: unknown): MatterPresentation {
  const p = record(input);
  if (typeof p.id !== 'string' || !uuid.test(p.id) || ![p.tenant,p.user,p.chat].every(v => bounded(v,200)) ||
    !bounded(p.title,100) || !bounded(p.text,1000) || (p.action !== 'switch' && p.action !== 'route') ||
    !Array.isArray(p.choices) || p.choices.length < 1 || p.choices.length > 7 ||
    p.choices.some(choice => !target(record(choice).id) || !bounded(record(choice).label,120)) ||
    (p.anchor !== undefined && (p.action !== 'switch' || !target(p.anchor) || p.anchor !== record(p.choices[0]).id || p.choices.length !== 1))) {
    throw Error('Invalid matter card');
  }
  return p as unknown as MatterPresentation;
}

export function redactMatterPresentation(p: MatterPresentation, redact: (text: string) => string): MatterPresentation {
  return { ...p, title: redact(p.title), text: redact(p.text), choices: p.choices.map(c => ({ ...c, label: redact(c.label) })) };
}

export function matterCard(p: MatterPresentation) {
  return { schema: '2.0', config: { update_multi: true },
    header: { title: { tag: 'plain_text', content: p.title }, template: p.action === 'route' ? 'orange' : 'blue' },
    body: { padding: '12px', vertical_spacing: '8px', elements: [
      { tag: 'div', text: { tag: 'plain_text', content: p.text } },
      ...p.choices.map(choice => ({ tag: 'button', type: 'default', width: 'fill', size: 'large',
        text: { tag: 'plain_text', content: choice.label },
        behaviors: [{ type: 'callback', value: { kind: 'matter', id: p.id, choice: choice.id } }] })),
    ] } };
}

export function normalizeMatterClick(input: unknown, appId: string): MatterClick | undefined {
  const e = record(input), actor = record(e.operator), context = record(e.context), action = record(e.action), value = record(action.value);
  if (e.schema !== '2.0' || e.app_id !== appId || e.host !== 'im_message' || !bounded(e.event_id,200) || !/^[a-zA-Z0-9_-]+$/.test(e.event_id) ||
    !bounded(e.tenant_key,200) || actor.tenant_key !== e.tenant_key || !bounded(actor.open_id,200) || !/^ou_[\w-]+$/.test(actor.open_id) ||
    !bounded(context.open_chat_id,200) || !bounded(context.open_message_id,200) || action.tag !== 'button' || value.kind !== 'matter' ||
    typeof value.id !== 'string' || !uuid.test(value.id) || !target(value.choice)) return;
  return { id: value.id, choice: value.choice, event: e.event_id, tenant: e.tenant_key, user: actor.open_id,
    chat: context.open_chat_id, message: context.open_message_id };
}
