import { join } from 'node:path';
import type { State } from '../state.js';
import { ownerKey } from '../types.js';
import { RefundObserver } from '../sls-refund/observer.js';
import { logDelaySeconds, pollRefundObserver } from '../sls-refund/poll.js';
import type { RefundQueue } from '../sls-refund/smq.js';
import type { ObserverConfig } from '../sls-refund/sls-source.js';
import type { PilotAdmission } from './gateway.js';

const intervalMs = 120_000;
const retryMs = 15_000;
const milestone = { open: '持续观测中', resolved: '观测确认恢复', 'needs-attention': '需人工核对' };
const outcomes = { completed: '完成', degraded: '降级', failed: '失败', timeout: '超时', overlap_skipped: '因重叠跳过' };
const timestamp = (seconds: number) => new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');

export function projectRefundNotices(observer: RefundObserver, admission: PilotAdmission, transport: State): void {
  if (admission.store.maintenance.paused || !admission.ownerPrivateChatConfirmed()) return;
  const { tenant, operator: user, chat } = admission.scope;
  const scope = { owner: ownerKey({ tenant, user, chat }), project: admission.project };
  for (const notice of observer.pendingNotices()) {
    const matter = admission.store.matters.ensureRefundIncident(scope, notice.incident);
    const report = ['最后触发 ' + timestamp(notice.lastFiring)];
    const sample = notice.observation;
    if (!sample) report.push('暂未采集到复查样本。');
    else {
      report.push('观察时间 ' + timestamp(sample.observed));
      if (sample.state === 'unavailable') {
        report.push(sample.reason === 'source-query-failed' ? '诊断查询失败。' : '样本缺失、过期或不完整。');
      } else {
        for (const row of sample.evidence.backlog) {
          const channel = row.channel === 'wechat_pay' ? '微信支付' : '支付宝';
          report.push(`${channel} · 待处理 ${row.pending} · 可查询 ${row.queryable} · 缺渠道身份 ${row.missing} · 最久 ${row.oldestSeconds} 秒`);
        }
        const job = sample.evidence.recovery!;
        report.push(`恢复 Job · ${outcomes[job.outcome]} · 查询错误 ${job.queryErrors} · 推迟 ${job.deferred}`);
      }
    }
    if (notice.state === 'needs-attention') report.push('当前证据未能确认恢复。');

    const text = report.join('\n');
    transport.enqueueRefundMatter({ id: notice.card, tenant, user, chat, title: '商家退款 · ' + milestone[notice.state],
      text: text + '\n\n回复这张卡片可在同一事项里追问。', source: 'sls-refund', action: 'switch', anchor: matter.id, choices: [{ id: matter.id, label: '切到此事项' }] });
    observer.noticeProjected(notice.card);
  }
}

export class ManagedRefundObserver {
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private stopping = false;
  private retryObservationAt = 0;

  constructor(private observer: RefundObserver, private config: ObserverConfig, private admission: PilotAdmission,
    private transport: State, private assertHeld: () => void, private poll = pollRefundObserver, private queue?: RefundQueue) {}

  start(): void {
    if (this.work || this.timer || this.stopping) throw Error('SLS refund observer already started or stopped');
    this.schedule();
  }

  private schedule(): void {
    let delay = this.queue ? 1_000 : intervalMs;
    this.work = this.cycle().catch(() => {
      console.error('SLS refund cycle unavailable; retained state will be retried');
      if (this.queue) delay = retryMs;
    }).finally(() => {
      this.work = undefined;
      if (!this.stopping) this.timer = setTimeout(() => { this.timer = undefined; this.schedule(); }, delay);
    });
  }

  private canContinue(): boolean {
    if (this.stopping || this.admission.store.maintenance.paused) return false;
    this.assertHeld();
    return true;
  }

  private async cycle(): Promise<void> {
    if (!this.canContinue()) return;
    if (this.queue) return this.subscriptionCycle(this.queue);
    const caughtUp = await this.poll(this.observer, this.config, { canContinue: () => this.canContinue() });
    if (caughtUp && this.canContinue()) projectRefundNotices(this.observer, this.admission, this.transport);
  }

  private async subscriptionCycle(queue: RefundQueue): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const canContinue = () => this.canContinue();
    if (Date.now() >= this.retryObservationAt &&
      (this.observer.nextSample(now) || this.observer.notificationReadDue(now - logDelaySeconds))) {
      try {
        const caughtUp = await this.poll(this.observer, this.config, { canContinue });
        if (caughtUp && canContinue()) this.observer.finishNotificationReads();
      } catch {
        this.retryObservationAt = Date.now() + retryMs;
        console.error('SLS refund evidence unavailable; queue intake continues');
      }
    }
    if (!canContinue()) return;
    projectRefundNotices(this.observer, this.admission, this.transport);
    const delivery = await queue.receive(canContinue);
    if (!delivery || !canContinue()) return;
    this.observer.retainNotification(delivery, Math.floor(Date.now() / 1000));
    await queue.acknowledge(delivery.receipt, canContinue);
  }

  async close(): Promise<void> {
    if (this.stopping) { await this.work; return; }
    this.stopping = true;
    clearTimeout(this.timer);
    await this.work;
    this.observer.close();
  }
}

export function managedRefundObserver(config: ObserverConfig, admission: PilotAdmission, transport: State, assertHeld: () => void,
  queue?: RefundQueue) {
  return new ManagedRefundObserver(new RefundObserver(join(admission.stateDirectory, 'sls-refund'), config.binding),
    config, admission, transport, assertHeld, pollRefundObserver, queue);
}
