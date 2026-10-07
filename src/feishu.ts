import * as lark from '@larksuiteoapi/node-sdk';
import { attachImages, contextText } from './chat-images.js';
import { MAX_CONTEXT_MESSAGES, CONTEXT_WINDOW_MS } from './context-limits.js';
import { markdownPost } from './reply.js';
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
  private imageLimit: number;

  constructor(credentials: { appId: string; appSecret: string }, enableGroups = false, imageLimit = 0) {
    this.imageLimit = imageLimit;
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
      data: { receive_id: chat, msg_type: 'post', content: JSON.stringify(markdownPost(text)), uuid: idempotencyKey },
    });
    if (result.code !== 0) throw new Error('Feishu rejected message delivery');
  }

  async context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext> {
    if (limit < 0 || limit > MAX_CONTEXT_MESSAGES || (!limit && !source.parentId) || !/^\d+$/.test(source.createTime ?? '')) return { status: 'unavailable', messages: [], note: '没有可用的消息时间或未启用群上下文。' };
    const cutoff = Number(source.createTime);
    try {
      if (!limit && source.parentId) {
        const quote = await this.client.im.v1.message.get({ path: { message_id: source.parentId } });
        if (quote.code !== 0) throw new Error('Quoted message access denied', { cause: quote.code });
        const items = contextItems(quote.data?.items ?? [], session.chat, source.id, cutoff, 1, true);
        const context = formatItems(items);
        context.note = context.messages.length ? '只包含用户明确引用的那一条消息；未读取群前文，附件未展开。' : context.note;
        return await attachImages(context, items, this.imageLimit, (message_id, file_key) => this.client.im.v1.messageResource.get({ path: { message_id, file_key }, params: { type: 'image' } }));
      }
      const result = await this.client.im.v1.message.list({ params: {
        container_id_type: 'chat', container_id: session.chat, page_size: limit,
        start_time: String(Math.max(0, Math.floor(cutoff / 1000) - CONTEXT_WINDOW_MS / 1000)),
        end_time: String(Math.floor(cutoff / 1000) + 1), sort_type: 'ByCreateTimeDesc', with_sender_name: true,
      } });
      if (result.code !== 0) throw new Error('History access denied', { cause: result.code });
      const items = contextItems(result.data?.items ?? [], session.chat, source.id, cutoff, limit);
      const context = formatItems(items);
      return await attachImages(context, items, this.imageLimit, (message_id, file_key) => this.client.im.v1.messageResource.get({ path: { message_id, file_key }, params: { type: 'image' } }));
    } catch (error) {
      const denied = record(error).cause === 230027 || record(record(record(error).response).data).code === 230027;
      return { status: 'unavailable', messages: [], note: denied
        ? '群聊前文读取权限尚未开通，请管理员先开通，或粘贴要讨论的内容。'
        : '当前机器人未能读取群聊前文；请引用相关消息或粘贴要讨论的内容。' };
    }
  }

  close(): void { this.socket.close({ force: true }); }
}

// Historical messages are reference material, never executable bridge commands.
export function formatContext(items: unknown[], chat: string, trigger: string, cutoff: number, limit: number, includeQuotedBot = false): ChatContext {
  return formatItems(contextItems(items, chat, trigger, cutoff, limit, includeQuotedBot));
}
function formatItems(items: Record<string, unknown>[]): ChatContext {
  const messages = items.map(item => ({
    sender: string(record(item.sender).sender_name) || (record(item.sender).sender_type === 'app' ? '机器人' : '群成员'),
    type: string(item.msg_type), text: contextText(item),
  }));
  return { status: messages.length ? 'available' : 'unavailable', messages, note: messages.length ? '仅包含当前群触发消息之前的有限前文；图片需以附图编号确认是否提供，附件、卡片和置顶文档未展开。' : '未读到可用的群聊前文；请引用或粘贴相关内容。' };
}
function contextItems(items: unknown[], chat: string, trigger: string, cutoff: number, limit: number, quoted = false): Record<string, unknown>[] {
  return items.map(record).filter(item => !item.deleted && item.chat_id === chat && item.message_id !== trigger &&
    /^\d+$/.test(string(item.create_time)) && Number(item.create_time) < cutoff && (quoted || Number(item.create_time) >= cutoff - CONTEXT_WINDOW_MS) &&
    (record(item.sender).sender_type === 'user' || quoted))
    .sort((a, b) => Number(b.create_time) - Number(a.create_time))
    .slice(0, Math.min(limit, MAX_CONTEXT_MESSAGES)).reverse();
}
