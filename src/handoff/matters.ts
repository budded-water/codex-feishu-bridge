import { randomUUID } from 'node:crypto';
import { ownerKey, type IncomingMessage } from '../types.js';
import type { State } from '../state.js';
import type { CardResult } from '../approval.js';
import { NEW_MATTER_CHOICE, type MatterClick, type MatterPresentation } from '../matter-card.js';
import { naturalControl } from '../ux.js';
import type { Admission, PilotAdmission } from './gateway.js';
import { DEFAULT_MATTER, DEFAULT_MATTER_TITLE, type HeldMatter, type Matter, type MatterNotice } from './matter-store.js';

const PAGE_SIZE = 6;
const USAGE = '发送 /matter-new 事项名称 新建并切换。发送 /matters 查看事项和默认对话。已选中事项可用 /matter-bind GitHub PR 链接 绑定对象。';
const defaultChoice = { id: DEFAULT_MATTER, label: DEFAULT_MATTER_TITLE };
const newChoice = { id: NEW_MATTER_CHOICE, label: '用这条消息开新话题' };
const conversation = (id: string) => id === DEFAULT_MATTER ? undefined : id;
const newTopic = /^(?:请\s*)?(?:换(?:个|一个)?话题|(?:另|再)?开(?:个|一个)?新(?:话题|对话)|新(?:话题|对话|任务))(?:(?:[，,：:。；;]\s*|\s+)([\s\S]*))?$/u;
const prReadLead = /^(?:(?:请|麻烦|帮我)\s*){0,3}(?:看(?:看|一下|下)|查(?:查|一下|下)?|检查|核对|审查|评估|分析|review\b|check\b|inspect\b)\s*(?:这个\s*PR\s*)?[（(「『]?\s*/iu;
const prShortAddress = /(?<![\w./-])([a-z0-9_.-]+\/[a-z0-9_.-]+)(?:\s*的\s*|\s+)PR\s*[#＃]([1-9][0-9]{0,11})(?![a-z0-9_-])/gi;
const urlBoundary = /^(?:$|[\s\p{Ps}\p{Pe}\p{Pi}\p{Pf}\x60<>"'*，。？！、；：…—]|\p{Script=Han}|[,;!](?=$|[\s\p{Pe}\p{Script=Han}]))/u;
const prReadDetail = /^(?:(?:当前|最近)?(?:状态|构建状态|合并状态|审核状态|改动|差异|检查结果|CI(?:\s*(?:状态|结果|为什么(?:没|没有|未)(?:跑|运行)))?)|(?:为什么|怎么)(?:没|没有|未)(?:跑|运行)\s*CI|(?:latest\s+)?(?:status|checks?|diff|CI(?:\s+status)?|merge status|review status)|why\s+CI\s+(?:didn['’]t\s+run|isn['’]t\s+running))$/iu;
const priorMessage = /^上一(?:条|轮)(?:的|里|中|[\s，,。？！?!]|$)/u;
const unanchoredEditSubject = /^(?:(?:刚才|刚刚|之前)(?:的)?(?:那个(?:方案)?|那件事)|(?:那)?(?:就)?(?:按(?:照)?|照|用)(?:(?:刚才|刚刚|之前)(?:的)?那个(?:方案)?|上一步(?:的结果)?))[，,：:]?\s*/u;
const editCommand = /^(?:修改|调整|改)(?=[成为為到回在用掉]|一下|下|吧|$|[\s，,。！？.!?：:；;…])/u;
const editLiteral = /\x60[^\x60]*\x60|「[^」]*」|『[^』]*』|“[^”]*”|‘(?:[^’\n]|’(?=[\p{Script=Latin}\p{N}_]))*’(?![\p{Script=Latin}\p{N}_])|"[^"\n]*"|(?<![\p{Script=Latin}\p{N}_])'(?:[^'\n]|'(?=[\p{Script=Latin}\p{N}_]))*'(?![\p{Script=Latin}\p{N}_])|《[^》]*》/gu;
const referenceUrlStart = /https?:\/\//giu;
const bareUrlEnd = /[\s<>"\x60）》】」』”]/u;
const bareUrlProsePunctuation = /[，。；：！？、]/u;
const markdownLinkTitle = /^\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\))\s*(?=\))/u;
const urlQueryBrackets: Readonly<Record<string, string>> = {
  '(': ')', '（': '）', '[': ']', '【': '】', '〔': '〕', '《': '》', '〈': '〉',
};
const wrappedUrlEnds: Readonly<Record<string, string>> = {
  ...urlQueryBrackets, '<': '>', '「': '」', '『': '』', '“': '”', '‘': '’', '"': '"', "'": "'", '\x60': '\x60',
};
const vagueFollowup = [
  /^(?:那)?(?:就)?(?:继续|接着)(?:上一步|刚才(?:的处理|那个)?)?(?:吧|啊|一下)?$/u,
  /^(?:刚才|刚刚|之前)(?:的)?(?:那个(?:方案)?|那一步|那件事|上一步)(?:呢|怎么样了)?$/u,
  /^(?:那个|上一步)(?:呢|怎么样了)$/u,
  /^(?:那)?(?:就)?(?:按|照|用)(?:(?:刚才|刚刚|之前)(?:的)?那个(?:方案)?|上一步(?:的结果)?)(?:做|改|处理|继续)(?:吧|一下)?$/u,
];

function pullRequest(value: string): string | undefined {
  const path = /^https:\/\/github\.com(?::443)?\/([^?#\s]+)(?:[?#]\S*)?$/i.exec(value)?.[1];
  if (!path) return;
  const match = /^((?!\.{1,2}\/)[a-z0-9_.-]+\/(?!\.{1,2}\/)[a-z0-9_.-]+\/pull\/[1-9][0-9]{0,11})(?:\/(?:files|commits|checks))?\/?$/i.exec(path);
  return match?.[1]?.toLowerCase();
}

function pullRequestAddresses(text: string): { ref: string; index: number; end: number }[] {
  const refs: { ref: string; index: number; end: number }[] = [];
  // A slash before an unrecognized character may introduce another path
  // segment. Only treat a trailing slash as complete at a prose boundary.
  // Query text can contain other URLs. Spaces or wrapping punctuation separate links.
  for (const match of text.matchAll(/https:\/\/[a-z0-9./_:%&=@~+-]+(?:[?#][a-z0-9./_:%?&#=@~+,$;!-]*)?/gi)) {
    const value = match[0];
    const end = match.index + value.length;
    if (!urlBoundary.test(text.slice(end))) continue;
    const address = value.replace(text[match.index - 1] === '_' ? /[.:_]+$/ : /[.:]+$/, '');
    if (!/[?#]/.test(value) && address.endsWith('/') && (address !== value ||
      !/^(?:$|[\s\p{Ps}\p{Pe}\p{Pi}\p{Pf}\x60<>"',;!，。？！、；：…])/u.test(text.slice(match.index + value.length)))) continue;
    const ref = pullRequest(address);
    if (ref) refs.push({ ref, index: match.index, end });
  }
  for (const match of text.matchAll(prShortAddress)) {
    const end = match.index + match[0].length;
    const suffix = text.slice(end);
    if (!urlBoundary.test(suffix) && !/^\.(?:$|\s)/u.test(suffix)) continue;
    const ref = pullRequest('https://github.com/' + match[1] + '/pull/' + match[2]);
    if (ref) refs.push({ ref, index: match.index, end });
  }
  return refs;
}

function pullRequests(text: string): string[] {
  return [...new Set(pullRequestAddresses(text).map(address => address.ref))];
}

function prReadOnlyTail(value: string): boolean {
  const text = value.trim().replace(/^[）)」』"']+\s*/u, '').replace(/^的\s*/u, '')
    .replace(/[。！？.!?]+$/u, '').trim();
  return text === '' || prReadDetail.test(text);
}

function topicTitle(input: string, ref?: string): string {
  if (ref) {
    const [, repo, , number] = ref.split('/');
    return repo!.slice(0, 27) + ' PR #' + number;
  }
  const firstLine = input.trim().split(/\r?\n/, 1)[0]!;
  const shortened = firstLine.replace(/^(?:(?:请|帮我|麻烦)\s*){0,3}(?:看看|看一下|查一下|查查|检查|研究一下|研究)\s*/u, '');
  return (shortened || firstLine).normalize('NFC').replace(/https:\/\/\S+/g, '链接')
    .replace(/[\u0000-\u001f:：]+/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, 42).replace(/[\uD800-\uDBFF]$/, '').trimEnd() || '新话题';
}

const words = new Intl.Segmenter('zh', { granularity: 'word' });
const latinWordChar = /[\p{Script=Latin}\p{N}\p{M}_]/u.source;
const startsLatinWord = new RegExp('^' + latinWordChar, 'u');
const endsLatinWord = new RegExp(latinWordChar + '$', 'u');

function titleTerms(title: string): string[] {
  const terms = [...title.split(/\s+/), ...Array.from(words.segment(title), item => item.isWordLike ? item.segment : '')];
  return terms.filter(term => term.length >= (/^[\x00-\x7f]+$/.test(term) ? 3 : 2)).map(term => term.toLowerCase());
}

function matchingTitleTerms(title: string, text: string): boolean {
  // Terms can trigger a choice. Only confirmed references select a matter.
  return titleTerms(title).some(term => text.includes(term));
}

function referenceUrlEnd(text: string, start: number, closer?: string): number {
  const nested: string[] = [];
  let queryOrFragment = false;
  let possibleQuoteEnd: number | undefined;
  let end = start;
  while (end < text.length) {
    const char = text[end]!;
    if (closer === ')' && char === '\\' && /[()\\]/u.test(text[end + 1] ?? '')) {
      end += 2;
      continue;
    }
    if (/\s/u.test(char)) break;
    if (char === nested.at(-1)) {
      nested.pop();
      end++;
      continue;
    }
    if (char === closer) {
      const singleQuote = char === "'" || char === '’';
      const after = text.slice(end + 1);
      const insideWord = endsLatinWord.test(text[end - 1] ?? '') && startsLatinWord.test(after);
      const beforeParameter = queryOrFragment && /^[&;][\w.%~-]+=/u.test(after);
      if (!singleQuote || (!insideWord && !beforeParameter)) return end;
      // It may close the wrapper before adjacent prose. Use it if there is no later closing quote.
      possibleQuoteEnd ??= end;
    }
    if (!closer && char === ')') break;
    if (char === '?' || char === '#') queryOrFragment = true;
    if (!closer) {
      const prosePunctuation = !queryOrFragment && (bareUrlProsePunctuation.test(char) ||
        (!nested.length && ',;!'.includes(char) && /^\p{Script=Han}/u.test(text.slice(end + 1))));
      if (bareUrlEnd.test(char) || prosePunctuation) break;
    }
    const pair = urlQueryBrackets[char];
    if (pair && (pair === closer || (!closer && (queryOrFragment || char === '(')))) nested.push(pair);
    end++;
  }
  return possibleQuoteEnd ?? end;
}

function withoutReferenceUrls(text: string): string {
  const parts: string[] = [];
  let consumed = 0;
  for (const { index, 0: scheme } of text.matchAll(referenceUrlStart)) {
    if (index < consumed) continue;
    const before = text.slice(consumed, index).trimEnd();
    const closer = wrappedUrlEnds[before.at(-1) ?? ''];
    const start = index + scheme.length;
    const end = closer ? referenceUrlEnd(text, start, closer) : undefined;
    parts.push(text.slice(consumed, index), ' ');
    if (end === undefined) {
      consumed = referenceUrlEnd(text, start);
      continue;
    }
    const titleStart = closer === '>' && text[end] === '>' ? end + 1 : end;
    const title = (closer !== '>' || text[end] === '>') && /\]\(\s*<?$/u.test(before)
      ? markdownLinkTitle.exec(text.slice(titleStart)) : null;
    if (title) consumed = titleStart + title[0].length;
    else consumed = text.slice(end).trimStart()[0] === closer ? end : referenceUrlEnd(text, start);
  }
  return parts.join('') + text.slice(consumed);
}

function separateTitleMentions(titles: Iterable<string>, normalized: string, eligible: (name: string, index: number) => boolean): string[] {
  const folded = normalized.toLowerCase();
  const spans: { index: number; name: string }[] = [];
  for (const title of titles) {
    if (!folded.includes(title.toLowerCase())) continue;
    const literal = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = startsLatinWord.test(title) ? '(?<!' + latinWordChar + ')' : '';
    const after = endsLatinWord.test(title) ? '(?!' + latinWordChar + ')' : '';
    for (const { index, 1: name } of normalized.matchAll(new RegExp('(?=' + before + '(' + literal + ')' + after + ')', 'giu'))) {
      if (name && eligible(name, index)) spans.push({ index, name });
    }
  }

  // Take longer matches first even when a shorter match starts earlier.
  const reserved = new Uint8Array(normalized.length);
  const mentions: string[] = [];
  for (const { index, name } of spans.sort((a, b) => b.name.length - a.name.length || a.index - b.index)) {
    const end = index + name.length;
    if (reserved.subarray(index, end).includes(1)) continue;
    reserved.fill(1, index, end);
    mentions.push(name);
  }
  return mentions;
}

function editMatterChoices(candidates: Matter[], text: string): Matter[] {
  if (candidates.length < 2) return [];
  const exact = new Map<string, Matter>();
  const foldedTitles = new Map<string, Matter | null>();
  const terms = new Map<string, Matter | null>();
  for (const matter of candidates) {
    const title = matter.title.normalize('NFC');
    const folded = title.toLowerCase();
    exact.set(title, matter);
    foldedTitles.set(folded, foldedTitles.has(folded) ? null : matter);
    for (const term of new Set(titleTerms(matter.title))) {
      terms.set(term, terms.has(term) ? null : matter);
    }
  }

  const normalized = text.normalize('NFC');
  const quoted = new Uint8Array(normalized.length);
  for (const { index, 0: literal } of normalized.matchAll(editLiteral)) {
    quoted.fill(1, index, index + literal.length);
  }
  const options = new Set([...exact.keys(), ...terms.keys()]);
  const eligible = (name: string, index: number) =>
    foldedTitles.has(name.toLowerCase()) || !quoted.subarray(index, index + name.length).includes(1);

  const mentioned = new Set<Matter>();
  for (const name of separateTitleMentions(options, normalized, eligible)) {
    const folded = name.toLowerCase();
    const complete = exact.get(name) ?? foldedTitles.get(folded);
    // A complete title takes priority at the same span. Shared terms cannot identify a matter.
    const matter = complete ?? (!foldedTitles.has(folded) ? terms.get(folded) : undefined);
    if (matter) mentioned.add(matter);
  }
  return candidates.filter(matter => mentioned.has(matter));
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
    const temporary = held.choices.includes(NEW_MATTER_CHOICE);
    const choices = held.choices.flatMap(id => {
      if (id === NEW_MATTER_CHOICE) return [newChoice];
      if (id === DEFAULT_MATTER) return [temporary ? { ...defaultChoice, label: '本条发给 · ' + defaultChoice.label } : defaultChoice];
      const m = this.admission.store.matters.owned(scope, id);
      return m ? [{ id, label: temporary ? '本条发给 · ' + m.title : m.title }] : [];
    });
    const text = held.answerExecution
      ? '引用的答案和正文指向不同事项。选定事项后才会处理这条消息。'
      : '任务已暂存。选择它所属的事项后，才会进入队列。';
    this.reply(held.message, text, {
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

  private explicitTargets(message: IncomingMessage, reference?: string, addressed?: string): string[] {
    const scope = this.scope(message), store = this.admission.store.matters;
    const linked = pullRequests(message.text).map(ref => store.bound(scope, ref));
    return [...new Set([reference, addressed, ...linked].filter((id): id is string => Boolean(id)))];
  }

  private holdConflict(message: IncomingMessage, targets: string[], input?: string, answerExecution?: string) {
    if (targets.length > PAGE_SIZE) {
      return this.requireResend(message, '这条消息关联了多个事项。请只保留目标事项的引用或 PR 链接后重发。');
    }
    return this.clarify(this.admission.store.matters.hold(this.scope(message), message, targets, input, answerExecution));
  }

  private answerMatter(message: IncomingMessage, execution: string): string | undefined {
    const scope = this.scope(message), store = this.admission.store;
    const source = store.ownedTask(execution, scope.owner, scope.project);
    if (source?.message.chatType === 'p2p') return store.matters.owned(scope, source.conversation)?.id ?? DEFAULT_MATTER;
  }

  holdConflictingAnswer(message: IncomingMessage, execution: string) {
    if (this.admission.store.maintenance.paused) return;
    const answer = this.answerMatter(message, execution);
    if (!answer) return;
    const address = this.address(message);
    const targets = this.explicitTargets(message, answer, address?.matter);
    if (targets.length > 1) return this.holdConflict(message, targets, address?.input, execution);
  }

  conflictsWithFileAnchor(message: IncomingMessage, originalConversation?: string, confirmedAnswer?: string): boolean {
    const scope = this.scope(message);
    const anchor = originalConversation
      ? this.admission.store.matters.owned(scope, originalConversation)?.id ?? DEFAULT_MATTER
      : confirmedAnswer ? this.answerMatter(message, confirmedAnswer) : this.state.matterReference(message)?.anchor;
    if (!anchor || this.opensNewTopic(message)) return true;
    return this.explicitTargets(message, undefined, this.address(message)?.matter).some(target => target !== anchor);
  }

  hasDisposition(message: IncomingMessage): boolean {
    const store = this.admission.store.matters;
    return this.owner(message) &&
      Boolean(store.held(message, this.admission.project) || store.notice(message));
  }

  hasNamedMatters(message: IncomingMessage): boolean {
    return this.admission.store.matters.list(this.scope(message), 1, 0, false).length > 0;
  }

  opensNewTopic(message: IncomingMessage): boolean {
    return this.owner(message) && newTopic.test(message.text.trim()) && !this.address(message);
  }

  overridesNaturalSteer(message: IncomingMessage): boolean {
    if (!this.owner(message)) return false;
    const scope = this.scope(message), store = this.admission.store.matters;
    if (this.state.matterReference(message) || this.address(message) ||
      pullRequests(message.text).some(ref => store.bound(scope, ref))) return true;
    if (message.parentId) return !this.state.referencedTask(message.parentId, scope.owner) &&
      (this.hasNamedMatters(message) || this.state.pendingRefundReference(message));
    const focus = store.focus(scope);
    return Boolean(focus && focus !== DEFAULT_MATTER && /^只(?:看|统计|查询|分析|读取)/.test(message.text.trim()) &&
      !this.admission.store.unsettled().some(execution => execution.status === 'active'));
  }

  private submit(message: IncomingMessage, selected?: string, input?: string): Admission {
    const reference = selected ? this.state.matterReference(message) : undefined;
    if (reference?.source === 'sls-refund' && reference.anchor === selected) {
      input = (input ?? message.text) + '\n\n引用的历史 SLS 只读观测，仅作参考：\n' + reference.text;
    }
    return this.admission.receive(message, selected && conversation(selected), input);
  }

  private startTopic(message: IncomingMessage, input: string, ref?: string): Admission {
    const address = this.admission.projectAddress(input);
    if (address?.outsidePilot) {
      this.admission.store.retainRefusal(message, 'outside_pilot');
      return { status: 'rejected', reason: 'outside_pilot' };
    }
    const task = address?.input ?? input;
    return this.admission.store.matters.startTask(this.scope(message), message, topicTitle(task, ref),
      id => this.admission.receive(message, id, task), ref);
  }

  route(message: IncomingMessage): Admission | { status: 'matter-choice' | 'duplicate' } {
    const submit = (selected?: string, input?: string) => this.submit(message, selected, input);
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
    const requestedTopic = !address && newTopic.exec(message.text.trim());
    if (requestedTopic) {
      const input = requestedTopic[1]?.trim() ?? '';
      if (!input || input.startsWith('/') || naturalControl(input) === 'stop') {
        return this.requireResend(message, '把新话题和第一条需求一起发过来，例如「换个话题，帮我看看小程序登录页」。');
      }
      return this.startTopic(message, input);
    }

    if (!address && this.admission.projectAddress(message.text)?.outsidePilot) return submit();
    const reference = this.state.matterReference(message);
    if (!reference && this.state.pendingRefundReference(message)) {
      return this.requireResend(message, '还有告警卡片在确认投递。请稍后重发这条引用，或去掉引用并写明事项。');
    }
    const targets = this.explicitTargets(message, reference?.anchor, address?.matter);
    if (targets.length > 1) return this.holdConflict(message, targets, address?.input);

    const focus = store.focus(scope);
    const text = message.text.trim();
    const lead = !message.parentId && !address && prReadLead.exec(text);
    if (lead) {
      const tail = text.slice(lead[0].length);
      const addresses = pullRequestAddresses(tail);
      const direct = addresses.find(item => item.index === 0);
      const multiple = direct && addresses.some(item => item.ref !== direct.ref);
      if (multiple || (!targets.length && focus && /PR\s*[#＃][1-9]/i.test(tail) && !addresses.length)) {
        const choices = [...new Set([...targets, focus ?? DEFAULT_MATTER, NEW_MATTER_CHOICE])];
        return this.clarify(store.hold(scope, message, choices));
      }
      if (!targets.length && direct && prReadOnlyTail(tail.slice(direct.end))) {
        return this.startTopic(message, message.text, direct.ref);
      }
    }
    if (targets.length === 1) return submit(targets[0], address?.input);

    const candidates = store.list(scope, -1, 0, false);
    const normalized = text.toLowerCase().normalize('NFC');
    const followup = text.replace(/[\s。？！.!?…]+$/u, '');
    const additive = !/^(?:这|那|上面|之前|刚才|剩下)/u.test(followup) &&
      /^[^\n，。？！：]{2,26}也(?:看看|看一下|看下|查一下|检查一下)$/u.test(followup);
    const editSubject = focus && !message.parentId ? unanchoredEditSubject.exec(text) : null;
    if (focus && !additive && editSubject && editCommand.test(text.slice(editSubject[0].length))) {
      const choices = editMatterChoices(candidates, withoutReferenceUrls(text));
      if (choices.length > 1) return this.holdConflict(message, choices.map(matter => matter.id));
      const alternate = store.alternateFocusForFollowup(scope);
      return alternate ? this.clarify(store.hold(scope, message, [focus, alternate])) : submit(focus);
    }

    const related = candidates.filter(m => matchingTitleTerms(m.title, normalized));
    // A reference to the preceding message is stronger than shared title words.
    if (focus && !message.parentId && !additive && priorMessage.test(normalized) &&
        !related.some(m => m.id !== focus && normalized.includes(m.title.toLowerCase().normalize('NFC')))) {
      const alternate = store.alternateFocusForFollowup(scope);
      return alternate ? this.clarify(store.hold(scope, message, [focus, alternate])) : submit(focus);
    }
    if (related.length > 1) {
      if (related.length > PAGE_SIZE) {
        return this.requireResend(message, '有多个可能的事项。请在 /matters 中选择，或引用事项卡片后重发。');
      }
      return this.clarify(store.hold(scope, message, related.map(m => m.id)));
    }

    const selected = focus;
    if (selected && !message.parentId) {
      if (vagueFollowup.some(pattern => pattern.test(followup))) {
        const alternate = store.alternateFocusForFollowup(scope);
        if (alternate) return this.clarify(store.hold(scope, message, [selected, alternate]));
      }
      if (additive) {
        const choices = [...new Set([selected, ...related.map(m => m.id), NEW_MATTER_CHOICE])];
        return this.clarify(store.hold(scope, message, choices));
      }
    }
    // A quoted parent may be a visible card whose delivery is still unconfirmed.
    if (selected && !message.parentId) return submit(selected);
    if (!candidates.length) return submit();
    return this.clarify(store.hold(scope, message, [...candidates.slice(0, PAGE_SIZE).map(m => m.id), DEFAULT_MATTER]));
  }

  click(click: MatterClick): { status: CardResult; flush?: true } {
    const actor: IncomingMessage = { tenant: click.tenant, chat: click.chat, user: click.user, chatType: 'p2p',
      id: 'matter-switch/' + click.event, text: '', parentId: click.message };
    if (!this.owner(actor)) return { status: 'rejected' };
    const scope = this.scope(actor), store = this.admission.store.matters;
    return store.decide(actor, () => {
      if (this.admission.store.maintenance.paused) return { status: 'rejected' };
      const card = this.state.matterCard(click);
      if (!card) return { status: 'rejected' };
      if (card.action === 'switch') return { status: store.select(scope, click.choice) ? 'accepted' : 'rejected' };
      const consumed = store.consume(scope, card.id, click.choice, (original, input, answerExecution) => {
        if (click.choice === NEW_MATTER_CHOICE) {
          const result = this.startTopic(original, input ?? original.text);
          return result.status === 'accepted' ? 'admitted' : result.status === 'blocked' || result.status === 'rejected' ? 'refused' : undefined;
        }
        if (answerExecution) {
          if (this.admission.projectAddress(original.text)?.outsidePilot) return;
          const sourceMatter = this.answerMatter(original, answerExecution);
          if (!sourceMatter) return;
          if (sourceMatter === click.choice) {
            if (this.state.confirmedAnswer(original) !== answerExecution) return;
            const reply = this.admission.store.acceptTaskReply(original, scope.project, answerExecution,
              original.parentId ? this.state.visualReviews.context(original.parentId) : undefined);
            if (reply?.status !== 'task-reply') return;
            return this.admission.store.requestForMessage(original) ? 'admitted' : 'refused';
          }
        }
        const admission = this.submit(original, click.choice, input);
        if ('request' in admission && admission.status !== 'duplicate') {
          return admission.status === 'blocked' ? 'refused' : 'admitted';
        }
      });
      return consumed ? { status: 'accepted', flush: true } : { status: 'rejected' };
    });
  }
}
