import { randomUUID } from 'node:crypto';
import type { Config } from '../config.js';
import type { State } from '../state.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import { message as present, section, copyBlock } from '../presentation.js';
import { reviewCommand } from '../permissions.js';
import type { ReviewFact } from '../permission-state.js';
import { parseReviewPresentation, reviewRetryMessage, type ReviewClick, type ReviewPresentation } from '../review-card.js';
import type { CardResult } from '../approval.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { isMaintenanceOwner } from './owner-access.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const labels = { approved: '已通过', denied: '已拒绝', timedOut: '审查超时', aborted: '审查已中止' };
const escape = (s: string) => s.replace(/[\\`*_{}\[\]()<>!|]/g, '\\$&');

export class OwnerPermissions {
  private work: Promise<void> = Promise.resolve();
  constructor(private admission: PilotAdmission, private config: Config, private native: NativeExecutions, private state: State) {}
  idle(): Promise<void> { return this.work; }

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message) || message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    this.enqueue(message, async () => {
      const ledger = this.native.permissions, text = message.text.trim();
      if (!ledger) return { body: '本实例尚未启用原生权限管理；当前没有改变任何规则或任务。' };
      if (text === '/rules') {
        const rows: string[] = [];
        for (const g of ledger.grants().filter(g => g.actor).slice(0, 10)) {
          let status = '当前规则文件无法核实';
          try { status = `${ledger.present(g.prefix) ? '默认文件中存在' : '默认文件中未见'} · ${ledger.revoked(g.prefix) ? '已设重新审查' : '未设 Bot 撤销'}`; } catch { /* Preserve uncertainty. */ }
          const decision = await ledger.userRuleDecision(g.prefix);
          rows.push(copyBlock(JSON.stringify(g.prefix.map(s => this.state.redact(s)))) + `\n${status} · 用户规则检查：${decision}\n` +
            `保存回执：${g.status === 'present' ? '曾观测到规则存在' : '已提交，尚无保存确认'}\n` + copyBlock(`/rules revoke ${g.id}`) + '\n' + copyBlock(`/rules allow ${g.id}`));
        }
        return { body: present('Codex 用户级规则', rows.length ? section('最近授权 · 最多 10 条', rows) : '尚无通过本 Bot 提交的长期授权。',
          section('作用范围', ['这些前缀允许参数变化，并可能用于其他仓库；影响共用当前 CODEX_HOME 的会话。这里只列 Bot 授权记录，其他规则仍可能生效。',
            '检查仅加载当前用户 rules 文件，不能替代项目、组织限制或实际完整命令审查。']),
          section('管理', ['revoke 添加 Bot 管理的 prompt 规则，后续匹配重新进入审查；allow 仅移除此覆盖，不补写 allow。',
            '已加载的执行器可能保留旧策略；不会中断已授权动作。规则变更不需要模型调用。'])) };
      }
      const change = new RegExp('^/rules (revoke|allow) (' + uuid + ')$', 'i').exec(text);
      if (change) {
        const result = await ledger.changeRule(JSON.stringify([message.tenant, message.id]), message.user, change[2]!.toLowerCase(), change[1]!.toLowerCase() === 'revoke');
        return { body: result === 'applied' ? '已核对 Bot 规则覆盖文件。变更面向后续加载的执行器；发送 /rules 查看当前状态。' :
          '这次规则变更结果未确认，不会自动重复。请发送 /rules 核对实际文件状态；未确认时不能假定授权已撤销或恢复。' };
      }
      if (text === '/reviews') {
        const facts = ledger.reviews('nonapproved').slice(0, 10);
        return { body: present('原生权限审查记录', section('最近非通过审查 · 最多 10 条', facts.length ? facts.map(f => `${labels[f.review.status]}\n${copyBlock('/review ' + f.id)}`) : ['暂无已记录的非通过审查。']),
          '审查结果针对单个动作；不代表整个任务失败。查询不会执行、重试或授权。') };
      }
      const query = new RegExp('^/review (' + uuid + ')$', 'i').exec(text), retry = new RegExp('^/review-retry (' + uuid + ')$', 'i').exec(text);
      const fact = ledger.review((query?.[1] ?? retry?.[1] ?? '').toLowerCase());
      if (!fact) return { body: '请用 /rules、/reviews 或 /review 完整编号 查看记录。没有新建任务。' };
      if (retry) return { body: await this.retry(message, fact) };
      const card = await this.presentation(fact);
      return { body: card.text, card: this.cardFits(card) ? card : undefined };
    });
    return { status: 'permission-control' as const };
  }

  click(click: ReviewClick): CardResult {
    const message = reviewRetryMessage(click, '');
    if (!isMaintenanceOwner(this.admission.scope, this.config, message)) return 'rejected';
    const card = this.state.reviewCard(click), fact = card && this.native.permissions?.review(card.review);
    if (!card || !fact) return 'rejected';
    if (card.consumed) return this.admission.store.retryForReview(fact.execution, fact.review.id) ? 'duplicate' : 'rejected';
    if (!card.retry) return 'rejected';
    this.enqueue(reviewRetryMessage(click, fact.id), async () => {
      const current = this.state.reviewCard(click);
      if (!current) throw Error('Native review card is no longer current');
      const body = await this.retry(reviewRetryMessage(click, fact.id), fact);
      return { body, finish: current.id };
    });
    return 'accepted';
  }

  private enqueue(message: IncomingMessage, run: () => Promise<{ body: string; card?: ReviewPresentation; finish?: string }>) {
    this.work = this.work.then(async () => {
      if (this.state.seen(message)) return;
      const value = await run();
      this.state.transaction(() => {
        if (!this.state.remember(message)) return;
        if (value.finish) this.state.finishReviewCard(value.finish, value.body);
        else this.state.send(message.chat, value.body, { replyTo: message.parentId && message.id.startsWith('permission-retry/') ? message.parentId : message.id, reviewCard: value.card });
      });
    }).catch(() => {
      try {
        this.state.transaction(() => {
          if (this.state.remember(message)) this.state.send(message.chat, '权限记录或执行条件暂时无法核实；请先用 /rules、/reviews 和 /tasks 核对。未知结果不会自动重复执行。',
            { replyTo: message.id.startsWith('permission-retry/') ? message.parentId : message.id });
        });
      } catch { console.error('Permission receipt unavailable; no automatic action replay'); }
    });
  }

  private async source(fact: ReviewFact) {
    const request = this.admission.store.requests().find(r => r.execution === fact.execution && r.project === this.admission.project);
    if (!request || request.message.chatType !== 'p2p' || request.message.tenant !== this.admission.scope.tenant || request.message.user !== this.admission.scope.operator || request.message.chat !== this.admission.scope.chat) throw Error('Unowned review');
    const evidence = this.native.evidence(fact.execution), projection = await this.native.projection(fact.execution);
    if (!projection.sealed || evidence.outcome.generation !== fact.generation || evidence.outcome.thread !== fact.review.thread || evidence.outcome.turn !== fact.review.turn ||
      !projection.reviews?.some(r => r.generation === fact.generation && r.body === JSON.stringify(fact.review))) throw Error('Native review does not match sealed evidence');
    return { request, evidence };
  }
  private async retryable(fact: ReviewFact): Promise<boolean> {
    const action = fact.review.action;
    if (fact.review.status !== 'denied' || !action) return false;
    const fields = [fact.review.rationale, action.cwd, ...(action.type === 'command' ? [action.command] : [action.program, ...action.argv])];
    if (fields.some(s => this.state.redact(s) !== s)) return false;
    if (!this.cardFits(this.card(fact, true))) return false;
    try {
      const { request } = await this.source(fact), execution = this.admission.store.execution(request.execution);
      return !this.admission.store.maintenance.paused && ['completed', 'interrupted'].includes(execution?.status ?? '') &&
        this.admission.store.requests().filter(r => r.conversation === request.conversation).at(-1)?.id === request.id &&
        !this.admission.store.unsettled().some(e => e.project === request.project);
    } catch { return false; }
  }
  private async presentation(fact: ReviewFact): Promise<ReviewPresentation> {
    const card = this.card(fact, await this.retryable(fact));
    if (!this.cardFits(card)) card.text += '\n\n本记录超过单张卡片限制，将以完整分段文本发送；不提供该记录的授权重试。请核对目录与动作后另行交办范围明确的新任务。';
    return card;
  }
  private cardFits(card: ReviewPresentation): boolean {
    try { parseReviewPresentation(card); return true; } catch { return false; }
  }
  private card(fact: ReviewFact, retry: boolean): ReviewPresentation {
    const r = fact.review;
    const text = present(`原生审查：${labels[r.status]}`, section('原因', [escape(this.state.redact(r.rationale))]), section('原动作', [copyBlock(reviewCommand(r, s => this.state.redact(s)))]),
      section('后续', [retry ? '你可以明确授权此动作并发起一次新任务。Codex 会重新审查，仍可能拒绝；不会保存长期规则。' :
        '当前没有可直接授权的重试。原任务可能已采用其他方案；请查看任务结果。超时、中止、保护未解除或会话已变化时，不沿用拒绝授权。']),
      section('详情', [copyBlock(`/task ${fact.execution}\n/review ${fact.id}`), '原任务与证据保持不变。如显示按钮，其有效期为 15 分钟，点击时重新核对。']));
    return { id: randomUUID(), review: fact.id, tenant: this.admission.scope.tenant, user: this.admission.scope.operator, chat: this.admission.scope.chat, text, retry, expires: Date.now() + 15 * 60_000 };
  }
  private async retry(message: IncomingMessage, fact: ReviewFact): Promise<string> {
    const previous = this.admission.store.retryForReview(fact.execution, fact.review.id);
    if (previous) return `这项拒绝已登记过一次重试，不会再次新建。\n\n${copyBlock('/task ' + previous.execution)}`;
    if (!await this.retryable(fact)) return '当前原生证据、会话或执行保护不满足重试条件，没有新建任务。请先查看原任务。';
    const { request, evidence } = await this.source(fact);
    const result = this.admission.store.acceptPermissionRetry(message, request, { sourceExecution: fact.execution, generation: fact.generation, checkpoint: evidence.checkpoint, review: fact.review },
      '本人明确授权对下列曾被原生审查拒绝的动作进行一次重试。仅处理这个动作，重新接受原生审查；不要保存长期权限、扩展为原任务的其他操作或自动重复。失败时说明实际原因。\n\n' + reviewCommand(fact.review));
    if ('paused' in result) return '系统维护暂停，没有新建重试任务。';
    return `已登记一次新的重试任务；原任务与审查记录保持不变。执行仍受 Codex 原生审查约束。\n\n${copyBlock('/task ' + result.request.execution)}`;
  }

  async publish(): Promise<void> {
    const ledger = this.native.permissions;
    if (!ledger) return;
    for (const fact of ledger.reviews('unpublished')) {
      const execution = this.admission.store.execution(fact.execution);
      if (!execution || !['completed', 'interrupted', 'unknown'].includes(execution.status)) continue;
      try {
        const request = this.admission.store.requests().find(r => r.execution === fact.execution);
        if (!request || ownerKey(request.message) !== ownerKey({ tenant: ledger.scope.tenant, user: ledger.scope.user, chat: ledger.scope.chat })) continue;
        const card = await this.presentation(fact);
        this.state.publishReview(card, request.message.id.startsWith('permission-retry/') ? request.message.parentId! : request.message.id, this.cardFits(card));
        ledger.published(fact.id);
      } catch { /* Retry publication by immutable identity, never retry execution. */ }
    }
  }
}
