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
