import type { Config } from '../config.js';
import type { State } from '../state.js';
import { ownerKey, type IncomingMessage } from '../types.js';
import { browserAccessText, type BrowserAccessBlock } from '../browser-access.js';
import { message as present, section, copyBlock } from '../presentation.js';
import type { PilotAdmission } from './gateway.js';
import type { NativeExecutions } from './native.js';
import { isMaintenanceOwner } from './owner-access.js';
import type { RequestRecord } from './store.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const browserAllowIntent = (text: string) => /^(?:允许浏览器(?:工具)?访问|允许访问(?:该)?(?:站点|网站))[。！!\s]*$/.test(text.trim());

export class OwnerBrowserAccess {
  private work: Promise<void> = Promise.resolve();
  constructor(private admission: PilotAdmission, private config: Config, private native: NativeExecutions, private state: State) {}
  idle(): Promise<void> { return this.work; }

  receive(message: IncomingMessage) {
    if (!isMaintenanceOwner(this.admission.scope, this.config, message) || message.unsupported || message.text.length > 30_000) return { status: 'rejected' as const };
    this.work = this.work.then(async () => {
      if (this.state.seen(message)) return;
      const text = message.text.trim();
      let body: string;
      if (browserAllowIntent(text)) {
        const request = this.admission.store.latestTask(ownerKey(message), this.admission.project);
        let blocks: BrowserAccessBlock[] | undefined;
        if (request) { try { blocks = (await this.native.progress(request.execution)).accessBlocks; } catch { /* Guidance never infers policy or launches work. */ } }
        body = present('浏览器授权需要实际生效',
          '已收到你的访问意图。当前接入没有修改浏览器站点设置的远程接口；这条消息没有保存授权，也没有启动任务。',
          blocks?.length ? browserAccessText(blocks) : '请在运行 Bot 的电脑上打开桌面应用 Settings → Computer Use → 对应浏览器 Manage，核对具体站点设置。当前没有可核实的结构化拒绝记录。',
          request ? section('查看原任务', [copyBlock('/task ' + request.execution)]) : undefined,
          '本机处理后，用原任务详情中的明确续接命令请求检查；文字“允许”不能证明站点已放行。');
      } else {
        const selected = new RegExp('^/browser-retry (' + uuid + ') local-change-confirmed$', 'i').exec(text);
        const request = selected && this.admission.store.ownedTask(selected[1]!.toLowerCase(), ownerKey(message), this.admission.project);
        body = request ? await this.retry(message, request) :
          '请从 /task 完整编号 查看具体阻塞。仅在本机处理站点权限并核对已发生的副作用后，使用详情中的 /browser-retry 命令；本入口不会修改浏览器权限。';
      }
      this.state.transaction(() => {
        if (this.state.remember(message)) this.state.send(message.chat, body, { replyTo: message.id });
      });
    }).catch(() => {
      try {
        this.state.transaction(() => {
          if (this.state.remember(message)) this.state.send(message.chat,
            '浏览器续接的处理结果暂时无法确认。请用 /tasks 核对；已登记的续接不会重复创建或执行，也没有改变浏览器设置。', { replyTo: message.id });
        });
      } catch { console.error('Browser access receipt unavailable; no automatic replay'); }
    });
    return { status: 'browser-access-control' as const };
  }

  private async retry(message: IncomingMessage, request: RequestRecord): Promise<string> {
    const previous = this.admission.store.browserRetryForSource(request.execution);
    if (previous) return `这个来源已登记过一个续接请求，没有再次创建。\n\n${copyBlock('/task ' + previous.execution)}`;
    const execution = this.admission.store.execution(request.execution);
    if (execution?.status !== 'completed' || this.admission.store.verification(request.execution) || this.admission.store.repairs.get(request.execution)) {
      return '当前只支持已收尾的普通任务。未确认或受保护的任务先检查；验证/修复任务需要从原专用入口明确交办，没有新建续接。';
    }
    const report = this.native.evidence(request.execution), projection = await this.native.projection(request.execution), blocks = projection.accessBlocks;
    if (!projection.sealed || !blocks?.length || blocks.some(b => b.task !== report.outcome.task || b.generation !== report.outcome.generation)) {
      return '没有可核实的封存浏览器拒绝观测，没有新建续接。旧任务未采集这类记录时，请在处理设置后重新明确交办剩余工作。';
    }
    if ([request.input, ...blocks.map(b => b.origin)].some(s => this.state.redact(s) !== s)) return '原任务含需脱敏内容，请重新明确交办剩余范围，没有新建续接。';
    const input = `本人声明已在本机处理浏览器站点设置，并已核对原任务已发生的动作与副作用；请求检查并继续尚未完成的工作。这不是浏览器权限已经生效的证明。先按技能在当前工具运行时建立连接，通过原 Browser Use 正常访问核实；若仍有保存的拒绝，立即停止受阻路径并说明，不得更换入口绕过。先核对已经完成或结果不明的动作，禁止重复提交；仅继续原任务中尚未完成且已授权的部分，报告实际结果及交付回执。不要修改权限规则或浏览器设置。\n\n原任务编号：${request.execution}\n历史受阻站点：${JSON.stringify([...new Set(blocks.map(b => b.origin))])}\n原任务内容（上下文，不表示重跑）：\n${request.input}`;
    const result = this.admission.store.acceptBrowserRetry(message, request, { sourceExecution: request.execution, checkpoint: report.checkpoint,
      generation: report.outcome.generation, thread: report.outcome.thread!, turn: report.outcome.turn!, blocks }, input);
    if ('rejected' in result) return '原任务会话、执行保护或输入范围不满足续接条件，没有新建任务。请查看原任务，或重新明确交办剩余范围。';
    if ('paused' in result) return '系统维护暂停，没有新建续接。恢复后请发送新消息。';
    return present('已登记检查与续接请求', '这是关联原任务的新普通请求。浏览器会实际校验访问；此回执不证明已放行或已经交付。',
      section('查看任务', [copyBlock('/task ' + result.request.execution), copyBlock('/task ' + request.execution)]));
  }
}
