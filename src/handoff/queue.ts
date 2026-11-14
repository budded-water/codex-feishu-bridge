import type { Config } from '../config.js';
import type { State } from '../state.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { PilotAdmission } from './gateway.js';
import { isMaintenanceOwner } from './owner-access.js';
import { OWNER_WITHDRAWN, type WithdrawalRecord } from './store.js';

const LIMIT = 10;
const usage = '查看 /队列 后发送 /撤回 完整请求编号，或引用自己原来的任务消息发送 /撤回。只处理尚未取得执行授权的请求。';

export function withdrawalNoticeTarget(admission: PilotAdmission, receipt: WithdrawalRecord): Pick<IncomingMessage, 'chat' | 'id'> | undefined {
  const request = admission.store.request(receipt.request);
  if (!request || request.project !== admission.project || receipt.actor !== ownerKey(request.message) ||
    request.message.tenant !== admission.scope.tenant || request.message.user !== admission.scope.operator ||
    request.message.chat !== admission.scope.chat || request.message.chatType !== 'p2p') return;
  const origin: unknown = JSON.parse(receipt.origin);
  if (!Array.isArray(origin) || origin.length !== 2 || origin[0] !== request.message.tenant || typeof origin[1] !== 'string') return;
  return { chat: request.message.chat, id: origin[1] };
}

export class OwnerQueue {
  constructor(private admission: PilotAdmission, private config: Config, private state: State) {}

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message)) return { status: 'ignored' as const };
    if (message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    if (!this.state.remember(message)) return { status: 'duplicate' as const };
    const text = message.text.trim();
    const owned = this.admission.store.requests().filter(row => row.project === this.admission.project &&
      ownerKey(row.message) === ownerKey(message) && row.message.chatType === 'p2p');
    if (text === '/队列') {
      const queued = owned.filter(row => row.blocked !== OWNER_WITHDRAWN && !this.admission.store.execution(row.execution));
      const lines = queued.slice(0, LIMIT).map(row => {
        const stamp = Number(row.message.createTime);
        const received = stamp > 0 && Number.isFinite(new Date(stamp).getTime()) ? new Date(stamp).toISOString() + '（UTC）' : '未记录';
        const blocked = row.blocked || this.admission.store.submission(row.id)?.status === 'blocked';
        return `请求编号：${row.execution}\n状态：${blocked ? '已阻断，未开始' : '等待派活'}；收到时间：${received}`;
      });
      this.state.send(message.chat, `尚未取得执行授权：${queued.length} 个${queued.length > LIMIT ? `（显示前 ${LIMIT} 个）` : ''}。\n` +
        lines.join('\n\n') + '\n' + usage, { replyTo: message.id });
      return { status: 'queue' as const };
    }
    const selector = /^\/撤回(?:\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?$/i.exec(text);
    const quoted = message.parentId ? owned.find(row => row.message.id === message.parentId) : undefined;
    const target = selector?.[1] ? owned.find(row => row.execution === selector[1]!.toLowerCase()) : quoted;
    if (!selector || !target || (message.parentId && quoted?.id !== target.id)) {
      this.state.send(message.chat, usage, { replyTo: message.id });
      return { status: 'rejected' as const };
    }
    let fresh: boolean;
    try { fresh = this.admission.store.withdraw(message, target.execution, this.admission.project).fresh; }
    catch {
      this.state.send(message.chat, '未撤回：请求可能已取得执行授权或身份不匹配。请查看 /status；运行中的任务使用 /stop，结果未确认时使用 /恢复。', { replyTo: message.id });
      return { status: 'rejected' as const };
    }
    if (!fresh) this.state.send(message.chat, '该请求已撤回，不会再次执行。', { replyTo: message.id });
    try { this.sync(); } catch { console.error('Committed withdrawal notice awaits projection'); }
    return { status: 'withdrawn' as const };
  }

  sync(): void {
    for (const receipt of this.admission.store.withdrawals()) {
      const target = withdrawalNoticeTarget(this.admission, receipt);
      const request = this.admission.store.request(receipt.request);
      if (target && request) this.state.projectWithdrawalNotice(receipt.origin, target, request.execution);
    }
  }
}
