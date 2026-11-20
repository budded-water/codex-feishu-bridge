import { relative, dirname, basename } from 'node:path';
import { message, section, copyBlock } from '../presentation.js';
import type { VerificationRecord } from './store.js';
import type { VerificationProfiles } from './verification-profile.js';
import { verificationApplicabilityState, type Applicability } from './verification-evidence.js';

const statusLabels: Record<string, string> = {
  pass: '通过', fail: '未通过', 'needs-review': '待人工复核', inconclusive: '无法得出结论', interrupted: '已中断',
  unverified: '未核实', blocked: '受阻', 'not-assessed': '未评估', planned: '等待执行', running: '正在验证', skipped: '已跳过', unknown: '结果未确认',
};

export function verificationText(value: VerificationRecord, context: { execution?: string[]; applicability?: string } = {}): string {
  const observation = value.observation;
  const status = observation?.status ?? value.phase;
  const integration = observation?.integration;
  const scope: string[] = [];
  if (integration) {
    const conclusions = integration.conclusions as Record<string, string> | null;
    if (conclusions) for (const [key, label] of [['code', '代码'], ['ui', 'UI'], ['release', '发布']] as const) {
      const outcome = conclusions[key];
      scope.push(`- ${label}：${statusLabels[outcome ?? ''] ?? outcome}`);
    }
    else scope.push('仅有 suite 观测；没有声明功能验收计划。');
  }
  const details = [`任务编号：${value.execution}`, `验证观测：${status}`];
  if (integration) {
    if (dirname(integration.summaryPath) === dirname(integration.htmlPath)) {
      details.push(`报告目录：${relative(value.definition.projectRoot, dirname(integration.summaryPath))}`,
        `JSON：${basename(integration.summaryPath)}`, `HTML：${basename(integration.htmlPath)}`);
    } else details.push(`JSON：${relative(value.definition.projectRoot, integration.summaryPath)}`,
      `HTML：${relative(value.definition.projectRoot, integration.htmlPath)}`);
  }
  const execution = [...(context.execution ?? [])];
  if (value.phase === 'unknown') execution.unshift('验证结果或清理未确认，不会自动重跑；执行保护以当前状态与检查后恢复记录为准。');
  return message(`验证${value.phase === 'unknown' ? '结果未确认' : statusLabels[status] ?? status} · ${value.profile}`,
    observation?.status === 'unverified' ? section('未核实原因', [observation.reason]) : undefined,
    section('执行状态', execution), section('声明范围', scope),
    context.applicability ? section('当前适用性', [context.applicability.replace(/^当前适用性：/, '')]) : undefined,
    section('范围说明', [context.applicability ? '独立代码 review 和发布授权未由此确认。' : '这是本次观测；当前适用性需另行核对。独立代码 review 和发布授权未由此确认。']),
    section('任务与报告 · 本机详情', [copyBlock(details.join('\n'))]));
}

const applicabilityText: Record<Applicability, string> = {
  profile: 'stale（受信任 profile 已变化或不可用）。',
  missing: 'unverified（没有完整验证观测）。',
  policy: 'stale（受信任验证规则已变化或不可用）。',
  changed: 'stale（源码或报告已变化）。',
  dirty: 'unverified（当前源码有未提交变更或子模块未就绪）。',
  unavailable: 'unverified（源码或证据无法核实）。',
  unchanged: '历史观测，Git 版本与报告未见变化；未重新验证运行环境或发布条件。',
};

export function verificationApplicabilityText(state: Applicability): string {
  return '当前适用性：' + applicabilityText[state];
}

export async function verificationApplicability(value: VerificationRecord, profiles: VerificationProfiles): Promise<string> {
  return verificationApplicabilityText(await verificationApplicabilityState(value, profiles));
}
