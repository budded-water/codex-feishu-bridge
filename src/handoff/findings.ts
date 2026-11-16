import { message as present, section, copyBlock } from '../presentation.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import type { VerificationRecord } from './store.js';
import type { VerificationProfiles } from './verification-profile.js';
import { verificationApplicability } from './verification-view.js';

const labels = { fail: '验证未通过', 'needs-review': '待人工复核', inconclusive: '无法得出结论',
  interrupted: '验证已中断', unverified: '验证未核实', pass: '记录为通过' };

export async function verificationFindings(admission: PilotAdmission, native: Pick<NativeExecutions, 'evidence'>,
  message: IncomingMessage, profiles: VerificationProfiles): Promise<string> {
  const seen = new Set<string>(), entries: string[] = [];
  const requests = admission.store.recentVerificationRequests(ownerKey(message), admission.project);
  let leads = 0;
  for (const request of requests) {
    if (request.message.chatType !== 'p2p') continue;
    const goal = admission.store.repairs.get(request.execution);
    const value: VerificationRecord | undefined = goal ? { execution: goal.execution, profile: goal.profile, digest: goal.digest,
      definition: goal.definition, phase: goal.status === 'unknown' ? 'unknown' : goal.status ? 'observed' : 'running',
      observation: goal.attempts.at(-1)?.observation ?? null } : admission.store.verification(request.execution);
    if (!value || seen.has(value.profile)) continue;
    seen.add(value.profile);
    const execution = admission.store.execution(request.execution);
    if (execution?.status === 'completed' && value.phase === 'observed' && value.observation?.status === 'pass' &&
      value.observation.cleanupSettled && (!goal || goal.status === 'pass')) continue;
    leads++;
    if (entries.length === 10) continue;
    let state: string, applicability: string | undefined;
    if (execution?.status === 'unknown' || value.phase === 'unknown' || goal?.status === 'unknown') {
      state = '结果未确认；请先检查进程与副作用，保护状态以 /status 和恢复记录为准。';
    } else if (!execution || execution.status === 'active' || (goal && !goal.status)) {
      state = '尚无已收尾的验证结论；排队、受阻或执行中，请查看 /status 与 /verification。';
    } else {
      try {
        native.evidence(request.execution);
        state = value.observation ? `历史观测：${labels[value.observation.status]}。原因需结合报告核对。`
          : '任务已收尾，没有验证观测。';
        if (goal?.status === 'stopped') state = '修复任务已停止；已有观测只代表停止前的历史记录。';
        applicability = await verificationApplicability(value, profiles);
      } catch { state = '封存证据无法核实；不能据此确认验证结论，请本机检查。'; }
    }
    entries.push(section(value.profile, [state, ...(goal?.status ? [`闭环记录：${goal.status}；${goal.reason}`] : []),
      ...(applicability ? [applicability] : []), copyBlock(`/verification ${request.execution}`)])!);
  }
  return present('验证线索', `需核对 ${leads} 个 profile${leads > 10 ? '（显示最新 10 个）' : ''}。`, ...entries,
    section('查询范围', [`仅检查本人当前工作区最近 ${requests.length} 条验证任务（上限 100），每个 profile 取最新登记任务；最新记录为通过的 profile 不列出。`,
      '较新任务取代旧线索不代表旧问题已修复；空列表不代表项目没有问题。完整历史仍可按任务编号查看。']),
    section('下一步', ['先核对报告与当前源码，再发送新的 /verify 或 /verify-repair 任务；本查询不会执行、重试或自动修复。',
      '线索不等于产品 Bug；独立 review、业务验收和发布授权仍分别判断。']));
}
