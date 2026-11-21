import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { ChatContext, ContextPort, FileAttachment } from '../types.js';
import { openResourceStream } from '../message-resource.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TIMEOUT_MS = 20_000;
export const attachmentUnavailable = '未能读取这条任务的附件，没有开始执行。请检查文件是否可访问、是否超过 10 MiB，然后重新发送文件并回复需求。';

export async function readAttachment(port: ContextPort | undefined, attachment: FileAttachment): Promise<string> {
  const open = port?.openAttachment?.bind(port);
  if (!open) throw Error('Attachment transport unavailable');
  const signal = AbortSignal.timeout(ATTACHMENT_TIMEOUT_MS);
  const stream = await openResourceStream(() => open(attachment), signal);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > MAX_ATTACHMENT_BYTES) throw Error('Attachment exceeds byte limit');
      chunks.push(chunk);
    }
  } finally { stream.destroy(); }
  return Buffer.concat(chunks, size).toString('base64');
}

function attachmentDirectory(root: string, execution: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(execution)) throw Error('Invalid attachment execution');
  return join(root, 'inbound-attachments', execution);
}

function checkPrivateDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())) throw Error('Unsafe attachment directory');
}

export function materializeAttachment(root: string, execution: string, attachment: FileAttachment, encoded: string): NonNullable<ChatContext['file']> {
  if (encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw Error('Invalid attachment data size');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_ATTACHMENT_BYTES || bytes.toString('base64') !== encoded) throw Error('Invalid attachment data');
  const directory = attachmentDirectory(root, execution);
  const parent = join(root, 'inbound-attachments');
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  checkPrivateDirectory(parent);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  checkPrivateDirectory(directory);
  const extension = extname(attachment.name);
  const path = join(directory, 'attachment' + (/^\.[a-zA-Z0-9]{1,16}$/.test(extension) ? extension : ''));
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
  return { path, name: attachment.name, bytes: bytes.length };
}

export function removeMaterializedAttachment(root: string, execution: string): void {
  const directory = attachmentDirectory(root, execution);
  try { checkPrivateDirectory(join(root, 'inbound-attachments')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  rmSync(directory, { force: true, recursive: true });
}
