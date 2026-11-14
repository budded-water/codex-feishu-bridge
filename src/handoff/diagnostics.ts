import type { State } from '../state.js';
import { ownerKey } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import type { SourceOutbox, HubDiagnostic } from './source.js';
import type { ExecutionRecord } from './store.js';

const label = { running: '仍在运行', exited: '已核实退出', unverified: '无法核实' };
const hubLabel = { queued: '等待派活', claimed: '执行中', done: '已结束', nothing: '无后续动作', cancelled: '已取消', failed: '失败' };

export async function incidentReport(admission: PilotAdmission, native: NativeExecutions, source: Pick<SourceOutbox, 'diagnose'>,
  state: State, execution: ExecutionRecord): Promise<string> {
  const request = admission.store.request(execution.request)!;
  const [observation, hub] = await Promise.all([native.diagnostics(execution.id),
    source.diagnose(request.id).catch((): HubDiagnostic => ({ status: 'unavailable' }))]);
  const queued = admission.store.requests().filter(row => row.project === execution.project && ownerKey(row.message) === ownerKey(request.message));
  const pending = queued.filter(row => !row.blocked && !admission.store.execution(row.execution) && admission.store.submission(row.id)?.status !== 'blocked').length;
  const blocked = queued.filter(row => row.blocked).length;
  const delivery = state.drainStatus();
  const current = admission.store.execution(execution.id)!;
  const held = admission.store.unsettled().some(row => row.id === execution.id);
  const outcome = { unknown: '未确认', active: '执行中', completed: '原生轮次已完成', interrupted: '已中断' }[current.status];
  const lines = [`恢复编号：${execution.id}`, `核查快照：${new Date().toISOString()}（UTC）`,
    `任务结果：${outcome}；本任务执行保护${held ? '仍保留' : '已解除'}。`,
    `执行器控制连接：${observation.connection === 'reachable' ? '已核实可连接' : '无法核实（未连通）'}`,
    `封存日志：${observation.sealed ? '已核实完整；原生子进程已封存退出。' : '无法核实；需要本机维护检查。'}`,
    `封存结果：${observation.sealedOutcome ? ({ completed: '原生轮次已完成', interrupted: '已中断', unknown: '未确认' }[observation.sealedOutcome]) : '无法核实'}。`];
  const processes = observation.processes;
  if (!processes) lines.push('任务进程登记：无法核实（缺少有效记录）。');
  else {
    lines.push(`登记的执行器进程：${label[processes.owner]}；原生进程：${label[processes.native]}。`);
    const counts = { running: 0, exited: 0, unverified: 0 };
    for (const child of processes.descendants) counts[child.state]++;
    lines.push(`已登记后代：${processes.descendants.length} 个；仍在运行 ${counts.running}，已核实退出 ${counts.exited}，无法核实 ${counts.unverified}。`);
    const running = processes.descendants.filter(row => row.state === 'running').slice(0, 8);
    if (running.length) lines.push('仍运行的登记 PID：' + running.map(row => row.pid).join('、') + (counts.running > running.length ? '（其余省略）' : ''));
    lines.push(`本次进程核查：${processes.currentAvailable ? '已完成' : '无法核实'}。`);
    lines.push(`最近成功观测：${processes.observedAt ? new Date(processes.observedAt).toISOString() : '无法核实'}；最近采样${processes.available ? '已完成' : '无法核实'}${processes.truncated ? '；登记达到上限' : ''}。`);
  }
  const stillRunning = processes && (processes.owner === 'running' || processes.native === 'running' || processes.descendants.some(row => row.state === 'running'));
  lines.push('进程范围：仅覆盖采样时已登记的进程；未登记或已脱离观测的进程仍需人工检查。',
    `已接收未执行：${pending}；已阻断：${blocked}；待投递：${delivery.outbox}；待审批：${delivery.prompts}。`,
    `Hub 调度轮次：${hub.status === 'verified' ? '已核实，' + hubLabel[hub.state] : '无法核实（' + ({ missing: '缺少绑定记录', unavailable: '未能读取', mismatch: '记录不匹配' }[hub.status]) + '）'}。`,
    '调度状态只描述该轮调度；Hub 问题卡片需独立维护。',
    '业务副作用：无法自动核实，请检查文件和外部服务的实际结果。',
    stillRunning ? '已观测到登记进程仍存在，请先核查或稍后刷新。' : observation.recoveryEligible && held && current.status === 'unknown' && !pending ? '封存与连接条件已满足；仍需本人核对后代进程及副作用后确认恢复。' : '恢复条件尚未核实，或仍有未执行队列；请按未核实项继续检查。',
    '以上为只读快照，恢复确认时会重新校验。');
  return lines.join('\n');
}
