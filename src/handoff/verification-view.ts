import { relative } from 'node:path';
import type { VerificationRecord } from './store.js';
import { boundedFile, fingerprint, gitRead, profileDigest, type VerificationProfiles } from './verification-profile.js';

export function verificationText(value: VerificationRecord): string {
  const observation = value.observation;
  const lines = [`验证 · ${value.profile}`, `任务编号：${value.execution}`,
    `验证观测：${observation?.status ?? (value.phase === 'skipped' ? 'skipped' : value.phase)}。`];
  if (observation?.status === 'unverified') lines.push('说明：' + observation.reason);
  const integration = observation?.integration;
  if (integration) {
    const conclusions = integration.conclusions as Record<string, string> | null;
    lines.push(conclusions ? `声明范围内：code ${conclusions.code} · UI ${conclusions.ui} · release ${conclusions.release}。` : '仅有 suite 观测；没有声明功能验收计划。');
    lines.push(`JSON：${relative(value.definition.projectRoot, integration.summaryPath)}`,
      `HTML：${relative(value.definition.projectRoot, integration.htmlPath)}`);
  }
  if (value.phase === 'unknown') lines.push('验证结果或清理未确认，不会自动重跑；执行保护以当前状态与检查后恢复记录为准。');
  lines.push('这是本次观测；当前适用性需另行核对。独立代码 review 和发布授权未由此确认。');
  return lines.join('\n');
}

export async function verificationApplicability(value: VerificationRecord, profiles: VerificationProfiles): Promise<string> {
  const p = Object.hasOwn(profiles, value.profile) ? profiles[value.profile] : undefined, o = value.observation;
  if (!p || profileDigest(p) !== value.digest) return '当前适用性：stale（受信任 profile 已变化或不可用）。';
  if (!o?.integration) return '当前适用性：unverified（没有完整验证观测）。';
  try {
    if (fingerprint(boundedFile(p.projectRoot, o.integration.summaryPath)) !== o.integration.jsonHash ||
      fingerprint(boundedFile(p.projectRoot, o.integration.htmlPath)) !== o.integration.htmlHash ||
      await gitRead(p.projectRoot, ['rev-parse', 'HEAD']) !== o.gitHead) return '当前适用性：stale（源码或报告已变化）。';
    if (await gitRead(p.projectRoot, ['status', '--porcelain', '--untracked-files=all'])) return '当前适用性：unverified（当前源码有未提交变更）。';
    return '当前适用性：历史观测，Git 版本与报告未见变化；未重新验证运行环境或发布条件。';
  } catch { return '当前适用性：unverified（源码或证据无法核实）。'; }
}
