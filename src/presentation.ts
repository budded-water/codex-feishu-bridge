import { fencedPreview } from './ux.js';

// Runtime-owned Markdown templates. Keep values and authority in their owners;
// the transport renders these without another model call or a new message type.
export function message(title: string, ...parts: (string | undefined)[]): string {
  return [`### ${title}`, ...parts.filter(part => part?.trim())].join('\n\n');
}

export function section(title: string, lines: string[]): string | undefined {
  return lines.length ? `**${title}**\n${lines.join('\n')}` : undefined;
}

export function copyBlock(text: string): string {
  return fencedPreview(text) ?? text;
}
