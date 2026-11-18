import { randomUUID } from 'node:crypto';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { State } from '../state.js';
import type { CardResult } from '../approval.js';
import type { MatterClick, MatterPresentation } from '../matter-card.js';
import type { Admission, PilotAdmission } from './gateway.js';
import { DEFAULT_MATTER, type HeldMatter, type MatterNotice } from './matter-store.js';

const PAGE_SIZE = 6;
const USAGE = '发送 /matter-new 事项名称 新建并切换。发送 /matters 查看事项和默认对话。已选中事项可用 /matter-bind GitHub PR 链接 绑定对象。';
const defaultChoice = { id: DEFAULT_MATTER, label: '默认对话' };
const conversation = (id: string) => id === DEFAULT_MATTER ? undefined : id;

function pullRequest(value: string): string | undefined {
  const path = /^https:\/\/github\.com(?::443)?\/([^?#\s]+)(?:[?#]\S*)?$/i.exec(value)?.[1];
  if (!path) return;
  const match = /^((?!\.{1,2}\/)[a-z0-9_.-]+\/(?!\.{1,2}\/)[a-z0-9_.-]+\/pull\/[1-9][0-9]{0,11})(?:\/(?:files|commits|checks))?\/?$/i.exec(path);
  return match?.[1]?.toLowerCase();
}

function pullRequests(text: string): string[] {
  const refs = new Set<string>();
  // A slash before an unrecognized character may introduce another path
  // segment. Only treat a trailing slash as complete at a prose boundary.
  for (const match of text.matchAll(/https:\/\/[a-z0-9./_:%?&#=@~+-]+/gi)) {
    const value = match[0];
    const address = value.replace(text[match.index - 1] === '_' ? /[.:_]+$/ : /[.:]+$/, '');
    if (address.endsWith('/') && (address !== value ||
      !/^(?:$|[\s\p{Ps}\p{Pe}\p{Pi}\p{Pf}\x60<>"',;!，。？！、；：…])/u.test(text.slice(match.index + value.length)))) continue;
    const ref = pullRequest(address);
    if (ref) refs.add(ref);
  }
  return [...refs];
}

const words = new Intl.Segmenter('zh', { granularity: 'word' });

function matchingTitleTerms(title: string, text: string): boolean {
  // Terms can trigger a choice. Only confirmed references select a matter.
  const terms = [...title.split(/\s+/), ...Array.from(words.segment(title), item => item.isWordLike ? item.segment : '')];
  return terms.some(term => term.length >= (/^[\x00-\x7f]+$/.test(term) ? 3 : 2) && text.includes(term.toLowerCase()));
}

export class OwnerMatters {
  constructor(private admission: PilotAdmission, private state: State) {}

  private owner(message: IncomingMessage): boolean {
    const s = this.admission.scope;
    return message.chatType === 'p2p' && message.tenant === s.tenant && message.user === s.operator && message.chat === s.chat;
  }

  private scope(message: IncomingMessage) {
    return { owner: ownerKey(message), project: this.admission.project };
  }

  private reply(message: IncomingMessage, text: string, card?: Omit<MatterPresentation, 'tenant' | 'user' | 'chat' | 'text'>): void {
    this.state.transaction(() => {
      if (!this.state.remember(message)) return;
      this.state.send(message.chat, text, { replyTo: message.id, ...(card && {
        matterCard: { ...card, tenant: message.tenant, user: message.user, chat: message.chat, text },
      }) });
    });
  }

  receive(message: IncomingMessage): { status: 'matter-view' | 'ignored' } {
    if (!this.owner(message) || message.unsupported || message.text.length > 30_000) return { status: 'ignored' };
    const s = this.scope(message), store = this.admission.store.matters, text = message.text.trim();
    const list = /^\/matters(?:\s+([1-9][0-9]{0,5}))?$/.exec(text);
    const title = /^\/matter-new\s+([^\n\r]+)$/.exec(text)?.[1]?.trim().normalize('NFC');
    const link = /^\/matter-bind\s+(https:\/\/github\.com\/[^\s]+)$/i.exec(text)?.[1];
    if (list) {
      const page = Number(list[1] ?? 1), value = store.list(s, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
      const focus = store.focus(s) ?? DEFAULT_MATTER;
      const choices = [...value.slice(0, PAGE_SIZE).map(m => ({ id: m.id, label: m.title })), defaultChoice]
        .map(c => c.id === focus ? { ...c, label: '当前 · ' + c.label } : c);
      this.reply(message, '点击切换，之后发送的普通消息会沿用选中的事项。' +
        (page > 1 ? '\n上一页 /matters ' + (page - 1) : '') +
        (value.length > PAGE_SIZE ? '\n下一页 /matters ' + (page + 1) : ''),
      { id: randomUUID(), title: '选择当前事项', action: 'switch', choices });
    } else {
      const notice = store.retainNotice(message, () => {
        if (this.admission.store.maintenance.paused) return { text: '系统正在维护。恢复后可以新建事项或绑定对象。' };
        if (title && title.length <= 50 && !/[\u0000-\u001f:：]/.test(title) && title !== defaultChoice.label) {
          const m = store.create(s, message, title);
          return { text: '已选中此事项。直接发送任务，或日后回复这张卡片继续。', card: {
            id: randomUUID(), title: m.title, action: 'switch', anchor: m.id,
            choices: [{ id: m.id, label: '切到此事项' }],
          } };
        }
        const ref = link && pullRequest(link);
        if (ref) {
          const result = store.bind(s, message, ref);
          return { text: result === 'bound' ? '已绑定 PR。之后包含该链接的任务会直达当前事项。'
            : result === 'conflict' ? '此 PR 已绑定其他事项，原关联继续有效。' : '先选择一个命名事项，再绑定 PR。' };
        }
        return { text: USAGE };
      });
      this.projectNotice(notice);
    }
    return { status: 'matter-view' };
  }

  private projectNotice(notice: MatterNotice): void {
    this.reply(notice.message, notice.text, notice.card);
    this.admission.store.matters.noticeProjected(notice.message);
  }

  private requireResend(message: IncomingMessage, text: string): { status: 'matter-choice' } {
    this.projectNotice(this.admission.store.matters.retainNotice(message, () => ({ text })));
    return { status: 'matter-choice' };
  }

  sync(): void {
    for (const notice of this.admission.store.matters.unprojectedNotices()) this.projectNotice(notice);
    for (const held of this.admission.store.matters.unprojected()) this.clarify(held);
  }

  private clarify(held: HeldMatter): { status: 'matter-choice' | 'duplicate' } {
    if (held.chosen) return { status: 'duplicate' };
    const scope = this.scope(held.message);
    const choices = held.choices.flatMap(id => {
      if (id === DEFAULT_MATTER) return [defaultChoice];
      const m = this.admission.store.matters.owned(scope, id);
      return m ? [{ id, label: m.title }] : [];
    });
    this.reply(held.message, '任务已暂存。选择它所属的事项后，才会进入队列。', {
      id: held.id, title: '这条任务属于哪件事？', action: 'route', choices,
    });
    this.admission.store.matters.projected(held.id);
    return { status: 'matter-choice' };
  }

  private address(message: IncomingMessage) {
    const match = /^([^\n:：]{1,50})(?:：|:(?!\/\/))\s*([\s\S]+)$/.exec(message.text.trim());
    if (!match) return;
    const matter = this.admission.store.matters.named(this.scope(message), match[1]!.trim().normalize('NFC'));
    return matter && { matter: matter.id, input: match[2]! };
  }

  hasDisposition(message: IncomingMessage): boolean {
    const store = this.admission.store.matters;
    return this.owner(message) &&
      Boolean(store.held(message, this.admission.project) || store.notice(message));
  }

  hasNamedMatters(message: IncomingMessage): boolean {
    return this.admission.store.matters.list(this.scope(message), 1).length > 0;
  }

  overridesNaturalSteer(message: IncomingMessage): boolean {
    if (!this.owner(message)) return false;
    const scope = this.scope(message), store = this.admission.store.matters;
    if (this.state.matterReference(message) || this.address(message) ||
      pullRequests(message.text).some(ref => store.bound(scope, ref))) return true;
    if (message.parentId) return Boolean(this.hasNamedMatters(message) &&
      !this.state.referencedTask(message.parentId, scope.owner));
    const focus = store.focus(scope);
    return Boolean(focus && focus !== DEFAULT_MATTER && /^只(?:看|统计|查询|分析|读取)/.test(message.text.trim()) &&
      !this.admission.store.unsettled().some(execution => execution.status === 'active'));
  }

  route(message: IncomingMessage): Admission | { status: 'matter-choice' | 'duplicate' } {
    const submit = (selected?: string, input?: string) => this.admission.receive(message, selected && conversation(selected), input);
    if (!this.owner(message) || message.unsupported || message.text.length > 30_000 || !message.text.trim() ||
      message.text.trimStart().startsWith('/') ||
      /^pair\s+[0-9a-f-]{36}$/i.test(message.text.trim())) return submit();

    const scope = this.scope(message), store = this.admission.store.matters;
    if (this.admission.store.requestForMessage(message)) return submit();
    const notice = store.notice(message);
    if (notice) {
      this.projectNotice(notice);
      return { status: 'matter-choice' };
    }
    const held = store.held(message, scope.project);
    if (held) return this.clarify(held);
    if (this.admission.store.maintenance.paused) return submit();

    const address = this.address(message);
    if (!address && this.admission.projectAddress(message.text)?.outsidePilot) return submit();
    const reference = this.state.matterReference(message);
    const linked = pullRequests(message.text).map(ref => store.bound(scope, ref));
    const targets = [...new Set([reference, address?.matter, ...linked].filter((id): id is string => Boolean(id)))];
    if (targets.length === 1) return submit(targets[0], address?.input);
    if (targets.length > 1 && targets.length <= PAGE_SIZE) return this.clarify(store.hold(scope, message, targets, address?.input));
    if (targets.length > PAGE_SIZE) {
      return this.requireResend(message, '这条消息关联了多个事项。请引用目标事项的卡片，或只保留对应的 PR 链接后重发。');
    }

    const candidates = store.list(scope, -1);
    const normalized = message.text.toLowerCase().normalize('NFC');
    const related = candidates.filter(m => matchingTitleTerms(m.title, normalized));
    if (related.length > 1) {
      if (related.length > PAGE_SIZE) {
        return this.requireResend(message, '有多个可能的事项。请在 /matters 中选择，或引用事项卡片后重发。');
      }
      return this.clarify(store.hold(scope, message, related.map(m => m.id)));
    }

    const selected = store.focus(scope);
    // A quoted parent may be a visible card whose delivery is still unconfirmed.
    if (selected && !message.parentId) return submit(selected);
    if (!candidates.length) return submit();
    return this.clarify(store.hold(scope, message, [...candidates.slice(0, PAGE_SIZE).map(m => m.id), DEFAULT_MATTER]));
  }

  click(click: MatterClick): { status: CardResult; admitted?: true } {
    const actor: IncomingMessage = { tenant: click.tenant, chat: click.chat, user: click.user, chatType: 'p2p',
      id: 'matter-switch/' + click.event, text: '', parentId: click.message };
    if (!this.owner(actor)) return { status: 'rejected' };
    const scope = this.scope(actor), store = this.admission.store.matters;
    return store.decide(actor, () => {
      if (this.admission.store.maintenance.paused) return { status: 'rejected' };
      const card = this.state.matterCard(click);
      if (!card) return { status: 'rejected' };
      if (card.action === 'switch') return { status: store.select(scope, click.choice) ? 'accepted' : 'rejected' };
      const request = store.consume(scope, card.id, click.choice, (original, input) => {
        const admission = this.admission.receive(original, conversation(click.choice), input);
        return 'request' in admission && admission.status !== 'duplicate' ? admission.request : undefined;
      });
      return request ? { status: 'accepted', admitted: true } : { status: 'rejected' };
    });
  }
}
