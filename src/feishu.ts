import * as lark from '@larksuiteoapi/node-sdk';
import { record, string, type IncomingMessage, type ContextPort, type Session, type Task, type ChatContext } from './types.js';

export function normalizeMessage(value: unknown, botOpenId?: string): IncomingMessage | undefined {
  // EventDispatcher flattens the v2 header and event into its callback argument.
  const event = record(value);
  const sender = record(event.sender);
  const message = record(event.message);
  if (sender.sender_type !== 'user' || !['p2p', 'group'].includes(string(message.chat_type)) || message.message_type !== 'text') return;
  let content: Record<string, unknown>;
  try { content = record(JSON.parse(string(message.content))); }
  catch { return; }
  let text = string(content.text);
  if (message.chat_type === 'group') {
    if (!botOpenId || !Array.isArray(message.mentions)) return;
    const mentions = message.mentions.map(record).filter(mention =>
      string(record(mention.id).open_id) === botOpenId && /^@_user_\d+$/.test(string(mention.key)));
    const keys = new Set(mentions.map(mention => string(mention.key)));
    if (!(text.match(/@_user_\d+/g) ?? []).some(key => keys.has(key))) return;
    text = text.replace(/@_user_\d+/g, key => keys.has(key) ? '' : key);
    text = text.trim();
  }
  const result: IncomingMessage = {
    tenant: string(event.tenant_key), user: string(record(sender.sender_id).open_id),
    chat: string(message.chat_id), id: string(message.message_id), text,
    chatType: message.chat_type as 'p2p' | 'group',
    ...(message.create_time ? { createTime: string(message.create_time) } : {}),
    ...(message.parent_id ? { parentId: string(message.parent_id) } : {}),
  };
  if (!result.tenant || !result.user || !result.chat || !result.id || !result.text.trim()) return;
  if (sender.tenant_key && sender.tenant_key !== result.tenant) return;
  return result;
}

const silentLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

export class Feishu implements ContextPort {
  private client: lark.Client;
  private socket: lark.WSClient;
  private enableGroups: boolean;

  constructor(credentials: { appId: string; appSecret: string }, enableGroups = false) {
    this.enableGroups = enableGroups;
    lark.defaultHttpInstance.defaults.timeout = 10_000;
    this.client = new lark.Client({ ...credentials, domain: lark.Domain.Feishu, logger: silentLogger });
    this.socket = new lark.WSClient({
      ...credentials, domain: lark.Domain.Feishu, logger: silentLogger,
      onReady: () => console.log('Feishu connection ready'),
      onReconnecting: () => console.log('Feishu reconnecting'),
      onError: () => console.error('Feishu connection unavailable; verify application configuration'),
    });
  }

  async start(receive: (message: IncomingMessage) => void): Promise<void> {
    let botOpenId: string | undefined;
    if (this.enableGroups) {
      const response = await this.client.request<{ code: number; bot?: { open_id?: string } }>({ method: 'GET', url: '/open-apis/bot/v3/info/' });
      botOpenId = response.bot?.open_id;
      if (response.code !== 0 || !botOpenId || !/^ou_[\w-]+$/.test(botOpenId)) throw new Error('Cannot verify bot identity for group mentions');
    }
    await this.socket.start({
      eventDispatcher: new lark.EventDispatcher({ logger: silentLogger }).register({
        'im.message.receive_v1': data => {
          const message = normalizeMessage(data, botOpenId);
          if (message) receive(message);
        },
      }),
    });
  }

  async send(chat: string, text: string, idempotencyKey: string): Promise<void> {
    const result = await this.client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: { receive_id: chat, msg_type: 'text', content: JSON.stringify({ text }), uuid: idempotencyKey },
    });
    if (result.code !== 0) throw new Error('Feishu rejected message delivery');
  }

  async context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext> {
    if (limit < 0 || limit > 20 || (!limit && !source.parentId) || !/^\d+$/.test(source.createTime ?? '')) return { status: 'unavailable', messages: [], note: '没有可用的消息时间或未启用群上下文。' };
    const cutoff = Number(source.createTime);
    try {
      if (!limit && source.parentId) {
        const quote = await this.client.im.v1.message.get({ path: { message_id: source.parentId } });
        if (quote.code !== 0) throw new Error('Quoted message access denied');
        const context = formatContext(quote.data?.items ?? [], session.chat, source.id, cutoff, 1, true);
        context.note = context.messages.length ? '只包含用户明确引用的那一条消息；未读取群前文，图片附件未展开。' : context.note;
        return context;
      }
      const result = await this.client.im.v1.message.list({ params: {
        container_id_type: 'chat', container_id: session.chat, page_size: limit,
        start_time: String(Math.max(0, Math.floor(cutoff / 1000) - 86400)),
        end_time: String(Math.floor(cutoff / 1000) + 1), sort_type: 'ByCreateTimeDesc', with_sender_name: true,
      } });
      if (result.code !== 0) throw new Error('History access denied');
      return formatContext(result.data?.items ?? [], session.chat, source.id, cutoff, limit);
    } catch { return { status: 'unavailable', messages: [], note: '当前机器人未能读取群聊前文；请引用相关消息或粘贴要讨论的内容。' }; }
  }

  close(): void { this.socket.close({ force: true }); }
}

// Historical messages are reference material, never executable bridge commands.
export function formatContext(items: unknown[], chat: string, trigger: string, cutoff: number, limit: number, includeQuotedBot = false): ChatContext {
  const messages = items.map(record).filter(item => !item.deleted && item.chat_id === chat && item.message_id !== trigger &&
    /^\d+$/.test(string(item.create_time)) && Number(item.create_time) < cutoff && (record(item.sender).sender_type === 'user' || includeQuotedBot))
    .slice(0, Math.min(limit, 20)).reverse().map(item => {
      let body: Record<string, unknown> = {};
      try { body = record(JSON.parse(string(record(item.body).content))); } catch { /* Malformed content stays explicit. */ }
      const type = string(item.msg_type);
      let text = type === 'text' ? string(body.text) : type === 'post' ? postText(body) : `[${type || '未知类型'}消息：内容尚未读取]`;
      if (Array.isArray(item.mentions)) for (const mention of item.mentions.map(record)) {
        const key = string(mention.key); if (/^@_user_\d+$/.test(key)) text = text.replace(/@_user_\d+/g, token => token === key ? `@${string(mention.name) || '成员'}` : token);
      }
      return { sender: string(record(item.sender).sender_name) || (record(item.sender).sender_type === 'app' ? '机器人' : '群成员'), type, text: (text || '[消息正文不可用]').slice(0, 1200) };
    });
  return { status: messages.length ? 'available' : 'unavailable', messages, note: messages.length ? '仅包含当前群触发消息之前的有限前文；图片、附件、卡片和置顶文档未展开。' : '未读到可用的群聊前文；请引用或粘贴相关内容。' };
}
function postText(body: Record<string, unknown>): string {
  const post = Array.isArray(body.content) ? body : record(body.zh_cn ?? body.en_us);
  const rows = Array.isArray(post.content) ? post.content : [];
  return [string(post.title), ...rows.map(row => Array.isArray(row) ? row.map(value => {
    const part = record(value); return ['text', 'a'].includes(string(part.tag)) ? string(part.text) + (part.href ? ` (${string(part.href)})` : '') : `[${string(part.tag) || '非文本'}：尚未读取]`;
  }).join('') : '')].filter(Boolean).join('\n');
}
