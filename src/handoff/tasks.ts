import { randomUUID } from 'node:crypto';
import { message as present, section, copyBlock } from '../presentation.js';
import { duration, taskTitle } from '../ux.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { State } from '../state.js';
import type { Config } from '../config.js';
import type { CardResult } from '../approval.js';
import type { TaskPresentation, TaskRefreshClick } from '../task-card.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { OWNER_WITHDRAWN, type RequestRecord, type VerificationRecord } from './store.js';
import { isMaintenanceOwner } from './owner-access.js';
import { verificationApplicability } from './verification-view.js';
import type { VerificationProfiles } from './verification-profile.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const usage = '发送 /tasks [页码] 查看任务，或 /task 完整任务编号 查看进度。查询不会执行或重跑任务。';
const labels: Record<string, string> = { pass: '通过', fail: '未通过', 'needs-review': '待人工复核', inconclusive: '无法得出结论',
  interrupted: '已中断', unverified: '未核实', planned: '尚未开始', running: '验证阶段', skipped: '已跳过', unknown: '结果未确认' };
const escape = (text: string) => text.replace(/[\\`*_{}\[\]()<>!|]/g, '\\$&');

export class OwnerTasks {
  private work: Promise<void> = Promise.resolve();
  constructor(private admission: PilotAdmission, private config: Config, private native: Pick<NativeExecutions, 'progress'>,
    private state: State, private profiles: VerificationProfiles) {}

  private owned(message: IncomingMessage, execution: string) {
    const request = this.admission.store.ownedTask(execution, ownerKey(message), this.admission.project);
    return request?.message.chatType === 'p2p' ? request : undefined;
  }

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message) || message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    this.enqueue(message, async () => {
      const text = message.text.trim(), list = /^\/tasks(?:\s+([1-9][0-9]{0,5}))?$/.exec(text);
      if (list) return { body: this.list(message, Number(list[1] ?? 1)) };
      const selected = new RegExp('^/task\\s+(' + uuid + ')$', 'i').exec(text);
      const request = selected && this.owned(message, selected[1]!.toLowerCase());
      if (!request) return { body: usage };
      const body = await this.detail(request);
      return { body, card: { id: randomUUID(), execution: request.execution, tenant: message.tenant, user: message.user, chat: message.chat, text: body } };
    });
    return { status: 'task-view' as const };
  }

  refresh(click: TaskRefreshClick): CardResult {
    const message: IncomingMessage = { tenant: click.tenant, user: click.user, chat: click.chat, id: 'task-refresh/' + click.event,
      parentId: click.message, chatType: 'p2p', text: '/task' };
    if (!isMaintenanceOwner(this.admission.scope, this.config, message)) return 'rejected';
    const card = this.state.taskView(click), request = card && this.owned(message, card.execution);
    if (!card || !request) return 'rejected';
    this.enqueue(message, async () => {
      const body = await this.detail(request);
      return { body, card: { ...card, text: body }, refresh: click };
    });
    return 'accepted';
  }

  private enqueue(message: IncomingMessage, read: () => Promise<{ body: string; card?: TaskPresentation; refresh?: TaskRefreshClick }>) {
    this.work = this.work.then(async () => {
      const value = await read();
      this.state.transaction(() => {
        if (!this.state.remember(message)) return;
        if (value.refresh && value.card) {
          if (!this.state.taskView(value.refresh) || !this.owned(message, value.card.execution)) throw new Error('Task card scope changed');
          this.state.refreshTaskView(value.card, value.refresh.message);
        } else this.state.send(message.chat, value.body, { replyTo: message.id,
          ...(value.card && { taskId: value.card.execution, taskView: value.card }) });
      });
    }).catch(() => {
      try {
        this.state.transaction(() => {
          if (this.state.remember(message)) this.state.send(message.chat, '任务进度暂时无法读取，没有启动任务。请稍后重新查询。', { replyTo: message.parentId ?? message.id });
        });
      } catch { console.error('Task progress answer could not be retained; query remains unacknowledged'); }
    });
  }

  idle(): Promise<void> { return this.work; }

  private facts(request: RequestRecord) {
    const store = this.admission.store, execution = store.execution(request.execution), goal = store.repairs.get(request.execution);
    const verification: VerificationRecord | undefined = goal ? { execution: goal.execution, profile: goal.profile, digest: goal.digest,
      definition: goal.definition, phase: goal.status === 'unknown' ? 'unknown' : goal.status ? 'observed' : goal.attempts.at(-1)?.phase === 'verifying' ? 'running' : 'planned',
      observation: goal.attempts.at(-1)?.observation ?? null } : store.verification(request.execution);
    const unknown = execution?.status === 'unknown' || goal?.status === 'unknown' || verification?.phase === 'unknown';
    const guarded = store.unsettled().some(row => row.id === request.execution);
    const blocked = request.blocked || store.submission(request.id)?.status === 'blocked';
    const status = request.blocked === OWNER_WITHDRAWN ? '已撤回，未开始' : unknown ? guarded ? '结果未确认，保护保留' : '历史结果未确认（当前无执行保护）' : !execution ? blocked ? '已阻断，未开始' : '排队中'
      : execution.status === 'active' ? goal?.stop ? '停止请求已记录，等待收尾' : goal?.status ? '闭环已记录结果，等待执行器收尾' : verification?.phase === 'running' ? '验证阶段' : '执行授权已取得'
      : execution.status === 'interrupted' ? '原生已中断' : '原生本轮已完成';
    const group = execution && (execution.status === 'active' || (execution.status === 'unknown' && guarded)) ? '执行 / 待处理' : !execution && request.blocked !== OWNER_WITHDRAWN ? '排队 / 阻断' : '已收尾 / 历史';
    return { execution, goal, verification, unknown, guarded, status, group };
  }

  private title(request: RequestRecord): string {
    return escape(taskTitle(this.state.redact(request.message.text).replace(/^\/verify(?:-repair)?\s+\S+\s+/, '')));
  }

  private list(message: IncomingMessage, page: number): string {
    const { requests, total } = this.admission.store.taskPage(ownerKey(message), this.admission.project, page), pages = Math.max(1, Math.ceil(total / 10));
    if (page > pages) return `页码超出范围，共 ${pages} 页。\n\n${usage}`;
    const groups = new Map<string, string[]>();
    for (const request of requests) {
      const facts = this.facts(request), lines = groups.get(facts.group) ?? [];
      const verification = facts.verification?.observation?.status;
      lines.push(`${this.title(request)}\n${facts.status}${verification ? ` · 验证观测：${labels[verification]}` : ''}\n${copyBlock('/task ' + request.execution)}`);
      groups.set(facts.group, lines);
    }
    return present('任务列表', `共 ${total} 个任务 · 第 ${page}/${pages} 页 · 每页最多 10 个。`,
      ...[...groups].map(([name, lines]) => section(name, lines)), total ? undefined : '暂无已登记任务。',
      section('查看与翻页', ['本人当前工作区；执行/仍受保护的未确认在前，其次未开始任务，再列历史记录。状态取自记录，详情可核对当前活动与证据。',
        ...(page < pages ? [copyBlock('/tasks ' + (page + 1))] : []), ...(page > 1 ? [copyBlock('/tasks ' + (page - 1))] : []),
        '列表随任务状态变化；历史任务仍可按完整编号查询。']));
  }

  private async detail(request: RequestRecord): Promise<string> {
    const initial = this.facts(request);
    let progress: Awaited<ReturnType<NativeExecutions['progress']>> | undefined;
    if (initial.execution && !initial.unknown) { try { progress = await this.native.progress(request.execution); } catch { /* Preserve unverified activity/evidence. */ } }
    const facts = this.facts(request), activity = progress?.activity;
    const lines = [facts.status];
    if (facts.unknown) lines.push(facts.guarded ? '请本机核对进程与副作用；本查询不解除保护或重跑任务。' : '当前无执行保护；历史结果保持未确认，后续工作仍需新任务。');
    else if (facts.execution?.status === 'active') {
      if (!progress?.live) lines.push('当前执行器活动无法核实；授权记录不证明进程仍在线。');
      else if (activity) lines.push(activity.stage, `本轮已用：${duration(Date.now() - activity.startedAt)}`,
        activity.lastEventAt ? `距最近 Codex 事件：${duration(Date.now() - activity.lastEventAt)}` : '尚未收到本轮 Codex 事件。');
      else lines.push('执行器可连接，尚无运行中的原生活动快照；以本任务阶段记录为准。');
    } else if (facts.execution) lines.push(progress ? '原生封存证据已核对。' : '原生封存证据无法核实；记录不能替代当前证据。');
    else if (this.admission.store.maintenance.paused) lines.push('系统维护暂停中。');
    if (progress?.startedAt && progress.finishedAt) lines.push(`末轮原生执行耗时：${duration(progress.finishedAt - progress.startedAt)}`);
    if (facts.goal) lines.push(`原生轮次：${facts.goal.attempts.length}/2 · 验证次数：${facts.goal.attempts.filter(a => a.observation).length}/2`,
      ...(facts.goal.status ? [`闭环记录：${({ pass: '声明验证通过', fail: '修复后仍未通过', ineligible: '需要人工接手', incomplete: '未完成', stopped: '已停止', unknown: '结果未确认' })[facts.goal.status]}`] : []));
    const prompts = !facts.unknown && facts.execution?.status === 'active' ? activity?.prompts.map(p => p.kind === 'approval' ? `等待审批：使用原审批卡片，或 /approve ${p.token}、/reject ${p.token}` : `等待回答：/answer ${p.token} 内容`) ?? [] : [];
    const actions = !facts.execution ? request.blocked === OWNER_WITHDRAWN ? [] : [copyBlock('/withdraw ' + request.execution)]
      : facts.execution.status === 'active' ? ['引用此卡片发送 /steer 内容 或 /stop，绑定本任务；停止需等待实际收尾。'] : [];
    const verification = facts.verification;
    const applicability = verification?.observation ? await verificationApplicability(verification, this.profiles) : undefined;
    const details = [`任务编号：${request.execution}`, `查询快照：${new Date().toISOString()}（UTC）`];
    const timestamp = Number(request.message.createTime);
    if (timestamp > 0 && Number.isFinite(new Date(timestamp).getTime())) details.push(`原消息时间：${new Date(timestamp).toISOString()}`);
    return present(this.title(request), section('进度', lines), section('需要你处理', [...prompts, ...actions]),
      verification ? section('项目验证', [`Profile：${verification.profile}`, `观测：${labels[verification.observation?.status ?? verification.phase] ?? '尚无结论'}`,
        ...(applicability ? [applicability] : []), copyBlock('/verification ' + request.execution)]) : undefined,
      section('详情', [copyBlock(details.join('\n')), '这是查询时快照；事件时间不证明模型网络健康。原生结束、验证、独立 review 与发布授权分别判断。']));
  }
}
