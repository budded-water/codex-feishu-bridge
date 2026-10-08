import type { Readable } from 'node:stream';
import { record, string, type ChatContext } from './types.js';
import { MAX_CONTEXT_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES, IMAGE_FETCH_BUDGET_MS } from './context-limits.js';

type FetchImage = (message: string, key: string) => Promise<{ getReadableStream(): Readable }>;
interface Reference { message: number; id: string; key: string }

export function messageBody(item: Record<string, unknown>): Record<string, unknown> {
  try { return record(JSON.parse(string(record(item.body).content))); }
  catch { return {}; }
}

export function postRows(body: Record<string, unknown>): { title: string; rows: unknown[] } {
  const post = Array.isArray(body.content) ? body : record(body.zh_cn ?? body.en_us);
  return { title: string(post.title), rows: Array.isArray(post.content) ? post.content : [] };
}

export function mentionText(text: string, mentions: unknown): string {
  const names = new Map<string, string>();
  if (Array.isArray(mentions)) for (const value of mentions) {
    const mention = record(value), key = string(mention.key);
    if (/^@_user_\d+$/.test(key)) names.set(key, string(mention.name).trim());
  }
  return text.replace(/@_user_\d+/g, key => names.get(key) ? `@${names.get(key)}` : '@成员（身份未知）');
}

function postMention(part: Record<string, unknown>, mentions: unknown): string {
  const id = string(part.user_id);
  if (id === 'all') return '@所有人';
  const values = Array.isArray(mentions) ? mentions.map(record) : [];
  const match = id ? values.find(value => string(value.id) === id || string(record(value.id).open_id) === id || string(value.key) === id) : undefined;
  const name = string(match?.name).trim() || string(part.user_name).trim();
  return name ? `@${name}` : '@成员（身份未知）';
}

export function contextText(item: Record<string, unknown>, imageDescription?: (key: string) => string): string {
  const body = messageBody(item);
  const type = string(item.msg_type);
  let text: string;
  if (type === 'text') text = string(body.text);
  else if (type === 'image' && imageDescription) text = imageDescription(string(body.image_key));
  else if (type === 'post') {
    const { title, rows } = postRows(body);
    text = [title, ...rows.map(row => Array.isArray(row) ? row.map(value => {
      const part = record(value);
      if (part.tag === 'at') return postMention(part, item.mentions);
      if (part.tag === 'img' && imageDescription) return imageDescription(string(part.image_key));
      return ['text', 'a', 'md', 'code_block'].includes(string(part.tag)) ? string(part.text) + (part.href ? ` (${string(part.href)})` : '') : `[${string(part.tag) || '非文本'}：尚未读取]`;
    }).join('') : '')].filter(Boolean).join('\n');
  } else text = `[${type || '未知类型'}消息：内容尚未读取]`;
  text = mentionText(text, item.mentions);
  return (text || '[消息正文不可用]').slice(0, 1200);
}

export async function attachImages(context: ChatContext, items: Record<string, unknown>[], limit: number, fetch: FetchImage): Promise<ChatContext> {
  if (!limit) return context;
  const refs: Reference[] = [];
  const descriptions = new Map<string, string>();
  const identity = (message: number, key: string) => JSON.stringify([message, key]);
  for (const [message, item] of items.entries()) {
    const body = messageBody(item);
    const keys = item.msg_type === 'image' ? [string(body.image_key)] : item.msg_type === 'post'
      ? postRows(body).rows.flatMap(row => Array.isArray(row) ? row.map(record).filter(part => part.tag === 'img').map(part => string(part.image_key)) : []) : [];
    for (const key of new Set(keys)) {
      descriptions.set(identity(message, key), '[图片：资源不可用，尚未读取]');
      if (/^om_[\w-]{1,200}$/.test(string(item.message_id)) && /^img_[\w-]{1,200}$/.test(key)) refs.push({ message, id: string(item.message_id), key });
    }
  }
  const images: NonNullable<ChatContext['images']> = [];
  let total = 0;
  let attempted = 0;
  const deadline = Date.now() + IMAGE_FETCH_BUDGET_MS;
  // Prefer recent images when the bounded page contains more than we can attach.
  for (const ref of refs.reverse()) {
    const token = identity(ref.message, ref.key);
    if (attempted >= Math.min(limit, MAX_CONTEXT_IMAGES) || total >= MAX_TOTAL_IMAGE_BYTES || Date.now() >= deadline) {
      descriptions.set(token, '[图片：达到本次读取限额，尚未读取]'); continue;
    }
    attempted++;
    try {
      const resource = await fetch(ref.id, ref.key);
      const stream = resource.getReadableStream();
      const timeout = setTimeout(() => stream.destroy(new Error('Image download timed out')), Math.max(1, deadline - Date.now()));
      let size = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const raw of stream) {
          const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          size += chunk.length;
          if (size > Math.min(MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES - total)) throw new Error('Image byte limit exceeded');
          chunks.push(chunk);
        }
      } finally { clearTimeout(timeout); stream.destroy(); }
      const buffer = Buffer.concat(chunks);
      const mime = imageMime(buffer);
      if (!mime) throw new Error('Unsupported image content');
      total += size;
      const label = `群聊参考图片 ${images.length + 1}`;
      images.push({ messageIndex: ref.message, label, url: `data:${mime};base64,${buffer.toString('base64')}` });
      descriptions.set(token, `[${label}：已附为图片输入，请根据图像内容判断]`);
    } catch { descriptions.set(token, '[图片：下载失败、格式不支持或超过大小限制，尚未读取]'); }
  }
  for (const [index, item] of items.entries()) {
    if (item.msg_type === 'image' || item.msg_type === 'post') {
      context.messages[index]!.text = contextText(item, key => descriptions.get(identity(index, key)) ?? '[图片：尚未读取]');
    }
  }
  context.images = images.sort((a, b) => a.messageIndex - b.messageIndex);
  context.note += ' 有编号的参考图片已作为图片输入附上；未附上的图片不可推测内容。';
  return context;
}

function imageMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return;
}
