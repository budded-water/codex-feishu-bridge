import * as lark from '@larksuiteoapi/node-sdk';
import { record, string, type IncomingMessage } from './types.js';

export function normalizeMessage(value: unknown): IncomingMessage | undefined {
  // EventDispatcher flattens the v2 header and event into its callback argument.
  const event = record(value);
  const sender = record(event.sender);
  const message = record(event.message);
  if (sender.sender_type !== 'user' || message.chat_type !== 'p2p' || message.message_type !== 'text') return;
  let content: Record<string, unknown>;
  try { content = record(JSON.parse(string(message.content))); }
  catch { return; }
  const result: IncomingMessage = {
    tenant: string(event.tenant_key), user: string(record(sender.sender_id).open_id),
    chat: string(message.chat_id), id: string(message.message_id), text: string(content.text),
  };
  if (!result.tenant || !result.user || !result.chat || !result.id || !result.text.trim()) return;
  if (sender.tenant_key && sender.tenant_key !== result.tenant) return;
  return result;
}

const silentLogger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };

export class Feishu {
  private client: lark.Client;
  private socket: lark.WSClient;

  constructor(credentials: { appId: string; appSecret: string }) {
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
    await this.socket.start({
      eventDispatcher: new lark.EventDispatcher({ logger: silentLogger }).register({
        'im.message.receive_v1': data => {
          const message = normalizeMessage(data);
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

  close(): void { this.socket.close({ force: true }); }
}
