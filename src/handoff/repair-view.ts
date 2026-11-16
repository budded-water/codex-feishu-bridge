import { message, section, copyBlock } from '../presentation.js';
import type { RepairGoal } from './repair-store.js';
import { verificationText } from './verification-view.js';

export function repairText(goal: RepairGoal, applicability?: string, ownerUnknown = false): string {
  const labels = { pass: '声明验证通过', fail: '修复后仍未通过', ineligible: '需要人工接手', incomplete: '未完成', stopped: '已停止', unknown: '结果未确认' };
  const last = goal.attempts.at(-1);
  const summary = message(`修复闭环 · ${ownerUnknown ? labels.unknown : goal.status ? labels[goal.status] : last?.phase === 'verifying' ? '正在验证' : '正在处理'}`,
    section('执行记录', goal.attempts.map(a => `- 第 ${a.ordinal} 轮：原生 ${a.native?.outcome.status ?? '等待或执行中'}；验证 ${a.observation?.status ?? '尚无观测'}`)),
    section('范围与下一步', [goal.status ? goal.reason : '最多追加一轮修复；/stop 可停止整个任务。',
      '验证通过只覆盖声明范围；独立 review、业务验收和发布授权仍分别判断。',
      ...(goal.status === 'unknown' || ownerUnknown ? ['执行保护保留；需要本机检查每轮进程与副作用，不会自动重跑。阶段是保留记录，不证明进程在线。'] : [])]),
    applicability ? section('当前适用性', [applicability]) : undefined,
    section('任务详情', [copyBlock(`任务编号：${goal.execution}\nProfile：${goal.profile}\n原生轮数上限：2\n验证次数上限：2`)]));
  if (!last?.observation) return summary;
  return summary + '\n\n' + verificationText({ execution: goal.execution, profile: goal.profile, digest: goal.digest,
    definition: goal.definition, phase: goal.status === 'unknown' ? 'unknown' : 'observed', observation: last.observation });
}
