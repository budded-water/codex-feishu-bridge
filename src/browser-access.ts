import type { DatabaseSync } from 'node:sqlite';
import { record } from './types.js';
import { message as present, section, copyBlock } from './presentation.js';

export interface BrowserAccessBlock {
  task: string; generation: string; item: string; origin: string; browser: string;
  code: 'persisted_user_denied'; observedAt: number;
}
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);

function origin(value: unknown): string | undefined {
  if (!text(value, 4000) || /\s/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin.length > 2000) return;
    return url.origin;
  } catch { return; }
}

// This is a report from the supported Browser Use tool, never permission authority.
export function browserAccessDenial(value: unknown): Pick<BrowserAccessBlock, 'item' | 'origin' | 'browser' | 'code'> | undefined {
  const item = record(value), meta = record(record(item.result)._meta), telemetry = record(meta['codex/telemetry']), surface = record(meta['codex/toolSurface']);
  if (item.type !== 'mcpToolCall' || item.server !== 'node_repl' || item.tool !== 'js' || item.status !== 'failed' || !text(item.id, 200) ||
    meta['codex/browserUse'] !== true || surface.kind !== 'browserUse' || telemetry.error_code !== 'persisted_user_denied') return;
  const target = origin(record(meta.browser_use).url);
  if (!target || !text(surface.browserFamily, 30) || !/^[a-z]+$/.test(surface.browserFamily)) return;
  return { item: item.id, origin: target, browser: surface.browserFamily, code: 'persisted_user_denied' };
}

export function parseBrowserAccessBlock(value: unknown): BrowserAccessBlock {
  const v = record(value), target = origin(v.origin);
  if (!text(v.task, 200) || !text(v.generation, 200) || !text(v.item, 200) || !text(v.browser, 30) || !/^[a-z]+$/.test(v.browser) ||
    v.code !== 'persisted_user_denied' || !Number.isSafeInteger(v.observedAt) || Number(v.observedAt) <= 0 || !target || target !== v.origin) throw Error('Invalid browser access observation');
  return { task: v.task, generation: v.generation, item: v.item, origin: v.origin as string, browser: v.browser,
    code: 'persisted_user_denied', observedAt: Number(v.observedAt) };
}

export function readBrowserAccessBlocks(db: DatabaseSync, task: string, generation?: string): BrowserAccessBlock[] | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='browser_access_blocks'").get()) return;
  return (db.prepare('SELECT body FROM browser_access_blocks WHERE task=?' + (generation ? ' AND generation=?' : '') + ' ORDER BY rowid DESC LIMIT 10').all(...(generation ? [task, generation] : [task])) as { body: string }[])
    .map(row => { const v = parseBrowserAccessBlock(JSON.parse(row.body)); if (v.task !== task || (generation && v.generation !== generation)) throw Error('Browser observation identity differs'); return v; });
}

export const browserRetryCommand = (execution: string) => `/browser-retry ${execution} local-change-confirmed`;
export function browserAccessText(blocks: BrowserAccessBlock[]): string {
  const targets = [...new Set(blocks.map(b => b.origin))];
  return present('浏览器站点权限观测', section('最近观测 · 最多 10 条', targets.map(copyBlock)),
    'Browser Use 报告已保存的访问拒绝或受管策略阻止了这些站点。这是历史工具观测，当前设置及任务交付结果仍需核对。',
    section('本机处理', ['在运行 Bot 的电脑上打开桌面应用 Settings → Computer Use → 对应浏览器 Manage，核对站点的阻止列表与允许范围。受管策略需由其管理员处理。',
      '飞书中的“允许”回复及命令规则不会修改浏览器站点设置。']));
}
