import type { Mention } from './types.js';

// Feishu post messages render Markdown through a native md element. Keep the
// durable outbox in Markdown, and convert only at the transport boundary.
export function markdownPost(text: string) {
  let fence: Fence | undefined;
  let blanks = 0;
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    const inside = !!fence;
    fence = nextFence(line, fence);
    if (inside || fence) { lines.push(line); blanks = 0; continue; }
    if (!line.trim()) { if (++blanks <= 1) lines.push(line); continue; }
    blanks = 0;
    // Small headings suit a chat bubble; never rewrite code or inline markup.
    lines.push(line.replace(/^(#{1,6})\s+/, (_, hashes: string) => `${hashes.length === 1 ? '####' : '#####'} `));
  }
  return { zh_cn: { content: [[{ tag: 'md', text: lines.join('\n') }]] } };
}

interface Fence { marker: string; opening: string }
function nextFence(line: string, fence?: Fence): Fence | undefined {
  const match = line.trimEnd().match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return fence;
  const marker = match[1]!;
  if (fence) return marker[0] === fence.marker[0] && marker.length >= fence.marker.length && !match[2]!.trim() ? undefined : fence;
  // Keep transport overhead bounded for normal language-labelled code fences.
  return Array.from(line).length <= 240 ? { marker, opening: line.trimEnd() } : undefined;
}

export function splitReply(text: string): string[] {
  if (!text) return [];
  // At most 3000 code points (~12 KB UTF-8), including added fence markers.
  // Reserve room for fence closure/reopening; split at lines when possible.
  const capacity = 2480;
  const chunks: string[] = [];
  let buffer = '';
  let length = 0;
  let fence: Fence | undefined;
  const flush = (final = false) => {
    if (!buffer) return;
    chunks.push(buffer + (fence ? `\n${fence.marker}` : ''));
    buffer = !final && fence ? `${fence.opening}\n` : '';
    length = Array.from(buffer).length;
  };
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const line of lines) {
    const points = Array.from(line);
    if (length && length + points.length > capacity) flush();
    let offset = 0;
    while (offset < points.length) {
      const count = Math.min(capacity - length, points.length - offset);
      buffer += points.slice(offset, offset + count).join('');
      length += count; offset += count;
      if (offset < points.length) flush();
    }
    fence = nextFence(line.replace(/\n$/, ''), fence);
  }
  flush(true);
  return chunks;
}


export function notificationPost(text: string, mentions: Mention[]) {
  const allowed = new Map(mentions.filter(x => /^ou_[\w-]+$/.test(x.id)).map(x => [x.id,x.name]));
  const pieces: ({ tag: 'md'; text: string } | { tag: 'at'; user_id: string; user_name: string })[] = [];
  const clean = safeMentionText(text);
  let offset = 0;
  let fence: Fence | undefined;
  let base = 0;
  const matches: { index: number; text: string; id: string }[] = [];
  for (const line of clean.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const inside=Boolean(fence); fence=nextFence(line.trimEnd(),fence);
    if (!inside && !fence) for (const match of line.matchAll(/\[\[notify:(ou_[\w-]+)\]\]/g)) matches.push({index:base+match.index,text:match[0],id:match[1]!});
    base+=line.length;
  }
  for (const match of matches) {
    if (match.index > offset) pieces.push({ tag: 'md', text: clean.slice(offset, match.index) });
    const name = allowed.get(match.id);
    pieces.push(name !== undefined ? { tag: 'at', user_id: match.id, user_name: name } : { tag: 'md', text: '成员（未通知）' });
    offset = match.index + match.text.length;
  }
  if (offset < clean.length || !pieces.length) pieces.push({ tag: 'md', text: clean.slice(offset) });
  return { zh_cn: { content: [pieces] } };
}

export function safeMentionText(text: string): string {
  let fence: Fence | undefined;
  return text.split('\n').map(line => {
    const inside = Boolean(fence); fence = nextFence(line,fence);
    return inside || fence ? line : line.replace(/<at\b[^>]*>(.*?)<\/at>/gi,(_,name:string)=>name || '成员').replace(/<\/?at\b[^>]*>/gi,'');
  }).join('\n');
}
