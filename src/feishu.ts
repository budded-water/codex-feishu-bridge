import * as lark from '@larksuiteoapi/node-sdk';
import { attachImages, contextText, mentionText, postRows } from './chat-images.js';
import { MAX_CONTEXT_MESSAGES, CONTEXT_WINDOW_MS } from './context-limits.js';
import { RECEIVED_EMOJI, type ReactionPort } from './feedback.js';
import { markdownPost, notificationPost, safeMentionText } from './reply.js';
import { record, string, type IncomingMessage, type ContextPort, type Session, type Task, type ChatContext, type DeliveryOptions } from './types.js';

export function normalizeMessage(value: unknown, botOpenId?: string): IncomingMessage | undefined {
  // EventDispatcher flattens the v2 header and event into its callback argument.
  const event = record(value);
  const sender = record(event.sender);
  const message = record(event.message);
  if (sender.sender_type !== 'user' || !['p2p', 'group'].includes(string(message.chat_type))) return;
  let content: Record<string, unknown>;
  try { content = record(JSON.parse(string(message.content))); }
  catch { return; }
  const unsupported = message.message_type !== 'text' ? string(message.message_type) || '未知格式' : undefined;
  let text = unsupported ? '不支持的消息格式' : string(content.text);
  if (message.chat_type === 'group') {
    if (!botOpenId || !Array.isArray(message.mentions)) return;
    const mentions = message.mentions.map(record).filter(mention =>
      string(record(mention.id).open_id) === botOpenId && /^@_user_\d+$/.test(string(mention.key)));
    const keys = new Set(mentions.map(mention => string(mention.key)));
    const addressed = unsupported ? message.message_type === 'post' && postRows(content).rows.some(row => Array.isArray(row) && row.map(record).some(part => part.tag === 'at' && (keys.has(string(part.user_id)) || part.user_id === botOpenId))) : (text.match(/@_user_\d+/g) ?? []).some(key => keys.has(key));
    if (!addressed) return;
    text = text.replace(/@_user_\d+/g, key => keys.has(key) ? '' : key);
    text = text.trim();
  }
  const members = Array.isArray(message.mentions) ? message.mentions.map(record).flatMap(mention => {
    const id = string(record(mention.id).open_id), name = string(mention.name).trim();
    return id !== botOpenId && /^ou_[\w-]+$/.test(id) && name && (!mention.tenant_key || mention.tenant_key === event.tenant_key) ? [{id,name:name.slice(0,80)}] : [];
  }).slice(0,50) : [];
  text = mentionText(text, message.mentions);
  const result: IncomingMessage = {
    tenant: string(event.tenant_key), user: string(record(sender.sender_id).open_id),
    chat: string(message.chat_id), id: string(message.message_id), text,
    chatType: message.chat_type as 'p2p' | 'group',
    ...(members.length ? { mentions: members } : {}),
    ...(unsupported ? { unsupported } : {}),
    ...(message.create_time ? { createTime: string(message.create_time) } : {}),
    ...(message.parent_id ? { parentId: string(message.parent_id) } : {}),
  };
  if (!result.tenant || !result.user || !result.chat || !result.id || !result.text.trim()) return;
  if (sender.tenant_key && sender.tenant_key !== result.tenant) return;
  return result;
}

function reactionGone(value: unknown): boolean {
  const error = record(value);
  const code = error.code ?? record(record(error.response).data).code;
  return [230110, 231003, 231011].includes(Number(code));
}

export const FEISHU_START_TIMEOUT_MS = 30_000;
export const FEISHU_HANDSHAKE_TIMEOUT_MS = 10_000;

const silentLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

export class Feishu implements ContextPort, ReactionPort {
  private client: lark.Client;
  private socket: lark.WSClient;
  private enableGroups: boolean;
  private imageLimit: number;
  private appId: string;
  private closed = false;
  private startup?: { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private failureListeners = new Set<() => void>();

  constructor(credentials: { appId: string; appSecret: string }, enableGroups = false, imageLimit = 0) {
    this.appId = credentials.appId;
    this.imageLimit = imageLimit;
    this.enableGroups = enableGroups;
    lark.defaultHttpInstance.defaults.timeout = 10_000;
    this.client = new lark.Client({ ...credentials, domain: lark.Domain.Feishu, logger: silentLogger });
    this.socket = new lark.WSClient({
      ...credentials, domain: lark.Domain.Feishu, logger: silentLogger,
      handshakeTimeoutMs: FEISHU_HANDSHAKE_TIMEOUT_MS,
      onReady: () => {
        if (this.closed) return;
        const startup = this.startup;
        if (startup) { clearTimeout(startup.timer); this.startup = undefined; startup.resolve(); }
        console.log('Feishu connection ready');
      },
      onReconnecting: () => console.log('Feishu reconnecting'),
      onError: () => this.connectionFailed(),
    });
  }

  async start(receive: (message: IncomingMessage) => void): Promise<void> {
    if (this.closed || this.startup) throw new Error('Feishu connection cannot be started');
    let botOpenId: string | undefined;
    if (this.enableGroups) {
      const response = await this.client.request<{ code: number; bot?: { open_id?: string } }>({ method: 'GET', url: '/open-apis/bot/v3/info/' });
      botOpenId = response.bot?.open_id;
      if (response.code !== 0 || !botOpenId || !/^ou_[\w-]+$/.test(botOpenId)) throw new Error('Cannot verify bot identity for group mentions');
    }
    if (this.closed) throw new Error('Feishu connection stopped');
    await new Promise<void>((resolve, reject) => {
      this.startup = { resolve, reject, timer: setTimeout(() => this.connectionFailed(), FEISHU_START_TIMEOUT_MS) };
      // SDK start() resolves before the socket handshake; readiness comes from onReady.
      void this.socket.start({
        eventDispatcher: new lark.EventDispatcher({ logger: silentLogger }).register({
          'im.message.receive_v1': data => {
            const message = normalizeMessage(data, botOpenId);
            if (message) receive(message);
          },
        }),
      }).catch(() => this.connectionFailed());
    });
  }

  onFailure(listener: () => void): () => void {
    this.failureListeners.add(listener);
    return () => { this.failureListeners.delete(listener); };
  }

  private connectionFailed(): void {
    if (this.closed) return;
    const startup = this.startup;
    this.startup = undefined;
    if (startup) clearTimeout(startup.timer);
    this.close();
    console.error('Feishu connection unavailable; verify application configuration');
    if (startup) startup.reject(new Error('Feishu connection unavailable; no live message connection'));
    else for (const listener of this.failureListeners) listener();
  }

  async send(chat: string, text: string, idempotencyKey: string, options: DeliveryOptions = {}): Promise<string | void> {
    const styled = markdownPost(safeMentionText(text)).zh_cn.content[0]![0]!.text;
    const content = JSON.stringify(notificationPost(styled,options.mentions ?? []));
    if (options.replyTo) {
      const response = await this.client.im.v1.message.reply({ path: { message_id: options.replyTo }, data: { msg_type: 'post', content, uuid: idempotencyKey } }).catch(error => {
        const code = Number(record(record(record(error).response).data).code ?? record(error).code);
        if ([230011,230110].includes(code)) return {code,data:undefined};
        throw error;
      });
      if (response.code === 0) return response.data?.message_id;
      // Only explicit recalled/deleted responses permit changing endpoints; uncertain errors retry the original UUID.
      if (![230011,230110].includes(response.code ?? -1)) throw new Error('Feishu rejected message delivery');
    }
    const response = await this.client.im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chat, msg_type: 'post', content, uuid: idempotencyKey } });
    if (response.code !== 0) throw new Error('Feishu rejected message delivery');
    return response.data?.message_id;
  }

  async addReaction(message: string): Promise<string> {
    const response = await this.client.im.v1.messageReaction.create({
      path: { message_id: message }, data: { reaction_type: { emoji_type: RECEIVED_EMOJI } },
    });
    if (response.code !== 0 || !response.data?.reaction_id) throw new Error('Reaction not confirmed');
    return response.data.reaction_id;
  }

  async findReaction(message: string): Promise<string | undefined> {
    let page: string | undefined;
    for (let count = 0; count < 10; count++) {
      const response = await this.client.im.v1.messageReaction.list({
        path: { message_id: message }, params: { reaction_type: RECEIVED_EMOJI, page_size: 50, page_token: page },
      }).catch(error => { if (reactionGone(error)) return { code: 231003, data: undefined }; throw new Error('Reaction reconciliation unavailable'); });
      if ([230110, 231003].includes(response.code ?? -1)) return;
      if (response.code !== 0 || !response.data) throw new Error('Reaction reconciliation unavailable');
      const own = response.data.items.find(item => item.operator?.operator_type === 'app' &&
        item.operator.operator_id === this.appId && item.reaction_type?.emoji_type === RECEIVED_EMOJI);
      if (own?.reaction_id) return own.reaction_id;
      if (!response.data.has_more) return;
      if (!response.data.page_token) break;
      page = response.data.page_token;
    }
    throw new Error('Reaction reconciliation exceeded page budget');
  }

  async removeReaction(message: string, reaction: string): Promise<void> {
    const response = await this.client.im.v1.messageReaction.delete({ path: { message_id: message, reaction_id: reaction } })
      .catch(error => { if (reactionGone(error)) return { code: 231011 }; throw new Error('Reaction removal unavailable'); });
    if (response.code !== 0 && ![230110, 231003, 231011].includes(response.code ?? -1)) throw new Error('Reaction removal not confirmed');
  }

  async actor(session: Session, message: string): Promise<{name?:string;link?:string}> {
    try {
      const response=await this.client.im.v1.message.get({path:{message_id:message},params:{user_id_type:'open_id',with_sender_name:true}});
      const item=response.data?.items?.find(item=>item.message_id===message && item.chat_id===session.chat && !item.deleted && item.sender?.sender_type==='user' && item.sender.id===session.user && (!item.sender.tenant_key || item.sender.tenant_key===session.tenant));
      if (response.code!==0 || !item) return {};
      return {name:item.sender?.sender_name?.slice(0,80),link:item.message_app_link && /^https:\/\/(?:applink\.)?feishu\.cn\//.test(item.message_app_link) ? item.message_app_link : undefined};
    } catch { return {}; }
  }

  async context(session: Session, source: NonNullable<Task['source']>, limit: number): Promise<ChatContext> {
    if (limit < 0 || limit > MAX_CONTEXT_MESSAGES || (!limit && !source.parentId && !source.clarification?.parentId) || !/^\d+$/.test(source.createTime ?? '')) return { status: 'unavailable', messages: [], note: '没有可用的消息时间或未启用群上下文。' };
    const cutoff = Number(source.createTime);
    const notes: string[] = [];
    let quoted: Record<string, unknown>[] = [], history: Record<string, unknown>[] = [];
    const references = [source.clarification, source].filter(value => value?.parentId && /^\d+$/.test(value.createTime ?? ''));
    const quoteSources = references.filter((value, index) => references.findIndex(other => other?.parentId === value?.parentId) === index);
    for (const reference of quoteSources) {
      if (!reference?.parentId) continue;
      try {
        const result = await this.client.im.v1.message.get({ path: { message_id: reference.parentId }, params: {with_sender_name:true} });
        if (result.code !== 0) throw new Error('Quoted message access denied');
        const admitted = contextItems(result.data?.items ?? [], session.chat, reference.id, Number(reference.createTime), 1, true)
          .filter(item => item.message_id === reference.parentId);
        quoted.push(...admitted);
        if (!admitted.length) notes.push('用户引用的消息不可用，请粘贴原文；不要猜测引用内容。');
      } catch { notes.push('未能读取用户引用的消息，请粘贴原文；不要用其他历史代替该引用。'); }
    }
    if (limit) {
      try {
        const result = await this.client.im.v1.message.list({ params: {
          container_id_type: 'chat', container_id: session.chat, page_size: limit,
          start_time: String(Math.max(0, Math.floor(cutoff / 1000) - CONTEXT_WINDOW_MS / 1000)),
          end_time: String(Math.floor(cutoff / 1000) + 1), sort_type: 'ByCreateTimeDesc', with_sender_name: true,
        } });
        if (result.code !== 0) throw new Error('History access denied', { cause: result.code });
        history = contextItems(result.data?.items ?? [], session.chat, source.id, cutoff, limit);
      } catch (error) {
        const denied = record(error).cause === 230027 || record(record(record(error).response).data).code === 230027;
        notes.push(denied ? '群聊前文读取权限尚未开通，请管理员先开通，或粘贴要讨论的内容。'
          : '当前机器人未能读取群聊前文；请引用相关消息或粘贴要讨论的内容。');
      }
    }
    // Keep at most original + latest clarification quotes, prioritizing the latter.
    const budget = limit || Math.max(1, quoteSources.length);
    quoted = quoted.slice(0, budget);
    const quoteIds = new Set(quoted.map(item => string(item.message_id)));
    const remaining = budget - quoted.length;
    const recent = remaining ? history.filter(item => !quoteIds.has(string(item.message_id))).slice(-remaining) : [];
    const items = [...quoted, ...recent];
    const context = formatItems(items, quoteIds);
    if (!limit && quoted.length) context.note = '只包含用户明确引用的消息；未读取群前文，附件未展开。';
    if (quoted.length) context.note += ' 标记 quoted 的消息是用户本次明确引用的对象，应优先用于理解追问。';
    context.note += notes.length ? ' ' + notes.join(' ') : '';
    return await attachImages(context, items, this.imageLimit, (message_id, file_key) => this.client.im.v1.messageResource.get({ path: { message_id, file_key }, params: { type: 'image' } }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.startup) {
      clearTimeout(this.startup.timer);
      this.startup.reject(new Error('Feishu connection stopped'));
      this.startup = undefined;
    }
    this.socket.close({ force: true });
  }
}

// Historical messages are reference material, never executable bridge commands.
export function formatContext(items: unknown[], chat: string, trigger: string, cutoff: number, limit: number, includeQuotedBot = false): ChatContext {
  return formatItems(contextItems(items, chat, trigger, cutoff, limit, includeQuotedBot));
}
function formatItems(items: Record<string, unknown>[], quotedIds?: Set<string>): ChatContext {
  const messages = items.map(item => ({
    sender: string(record(item.sender).sender_name) || (record(item.sender).sender_type === 'app' ? '机器人' : '群成员'),
    type: string(item.msg_type), text: contextText(item),
    ...(quotedIds?.has(string(item.message_id)) ? { quoted: true } : {}),
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
