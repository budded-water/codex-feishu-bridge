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

export const escapeMarkdownText = (text: string) => text.replace(/[\\`*_{}\[\]()<>!|]/g, '\\$&');

export function taskReceipt(routing: 'opened' | 'continued' | 'accepted', matter: string, progress?: string): string {
  const label = { opened: '新事项', continued: '续接事项', accepted: '事项' }[routing];
  return message('已接单', `**${label}** · ${escapeMarkdownText(matter)}\n执行结果会另发在同一条任务消息的回复里。`,
    progress ? section('查看进度', [copyBlock('/task ' + progress)]) : undefined);
}
