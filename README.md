# Codex Feishu Bridge

The opt-in [owner native-permissions feature](docs/native-permissions.md) is merged and deployed on the managed owner-private pilot with native Auto-review policy, proposal-bound Remember, rule inspection/revocation and explicit denied-command retry. Owner-private rule/review queries and one real read-only network command approved by native Auto-review without human intervention are accepted. Native Remember/save and approval-free reuse of one disclosed GitHub read prefix are also accepted; the temporary user-reviewer window is closed and Auto-review restored. Its [change](openspec/changes/enable-owner-native-permissions/tasks.md) remains active for owned revocation/renewed review and genuine Auto-review denial/retry acceptance.

把安装在你电脑上的 Codex 接到飞书，让你或同事通过私聊、群内 `@机器人` 提交工作。

它可以作为本地 Codex 的工作分身入口：在已登记的项目中分析问题、实现功能、修复 Bug、review 代码；GitHub、资料搜索、飞书工具等工作由本机 Codex 已配置的工具完成。模型推理仍使用 Codex 的模型服务，可通过 `codexReasoningEffort` 单独设置 bot 的推理强度，本地文件操作在运行桥接程序的电脑上执行。

The managed M6 pilot now uses compact task detail cards with native-state headings and expandable request/history/evidence. Source checks and deployment are verified. The owner has confirmed visible disclosure chevrons and clear expand/collapse behavior, with same-card refresh and unchanged task/evidence facts verified from backend records; this bounded client acceptance is recorded in [live acceptance](docs/live-acceptance.md).

## 先选择你的使用方式

| 使用方式 | 谁安装和配置 | 使用哪台电脑的环境 |
| --- | --- | --- |
| 同事使用你现有的分身 | 你维护一个 bridge；同事按 [使用说明](docs/usage.md) 操作机器人 | 你的 Codex、项目和工具身份 |
| 同事安装自己的分身 | 每位部署者按 [安装说明](docs/installation.md) 配置自己的应用、Codex 和项目 | 各部署者自己的环境 |

共享的是程序和配置模板。`Zhe! Bot` 是一个部署实例的自定义名称；代码不绑定这个名称、某个企业或某个本地项目。新部署者应使用自己的飞书应用和凭据，不复制别人的 `.env`、用户授权或状态数据库。同一个机器人应用不要同时连接多个独立 bridge：SDK 事件不会按“机器人属于哪台电脑”自动路由。

## 当前下载方式

从默认 `main` 分支下载完整实现。若试用尚未合并的后续 PR，请改用该 PR 的分支：

```bash
git clone https://github.com/budded-water/codex-feishu-bridge.git
cd codex-feishu-bridge
npm ci
cp .env.example .env
cp bridge.config.example.json bridge.config.json
```

替换所有占位值，按 [安装说明](docs/installation.md) 完成应用配置与身份登记后运行：

```bash
npm run doctor
npm run build
npm start
```

需要 Node.js 24 或更高版本，以及与 [协议版本文件](src/codex/generated/version.ts) **完全匹配**、已登录的 Codex。当前不是 npm 发布包，没有一键安装器；Git checkout 是安装入口。

## 功能与实际边界

部署者可按实际运行入口查看 [默认队列或 P1 Autoloop 的本机只读指标](docs/operation.md#metrics-after-live-setup)。

| 功能 | 当前行为 |
| --- | --- |
| 私聊 / 群聊入口 | 接收人类发送的文本；群里必须真实 `@` 此机器人，普通群消息不触发工作 |
| 通用工作区（可选） | workspace 模式直接交办任务，Codex 根据当次需求确认操作目标，沿用本机权限与审批 |
| 普通讨论 | 普通聊天直接回答；明确项目任务由 Codex 选择已登记项目，有歧义时提问；`/project` 可手动指定 |
| 功能开发 / Bug 修复 / Review | Codex 在登记的本地目录执行，沿用本机配置、工具和授权策略 |
| 提交分支 / 开 PR / 查资料 | 取决于本机 Codex 的相关工具、登录状态和项目规则；bridge 不自带 GitHub 或搜索账号 |
| 群聊前文 | 单页读取触发消息之前 24 小时内最多 50 条记录；默认关闭；明确引用单条消息可走引用模式 |
| 图片参考 | 可选读取前文或引用中的独立图片 / 富文本图片，作为真实 Codex 图片输入；最多 8 次尝试，默认关闭 |
| 会话与排队 | 按租户、用户、聊天、项目分会话；同一真实目录串行，不同目录可以独立执行 |
| 接收反馈 | 原消息添加 `OnIt` 表情；排队有说明；等待期间保持安静，只有需要确认时提问；最终答案单独发送 |
| 运行控制 | `/status`、`/steer`、`/stop`、`/clear`、`/new` |
| P1 逐任务进度 | 本人兼审批人可用 `/tasks` 看当前概览、`/tasks 1` 查完整记录、`/task 完整编号` 看详情并刷新；支持复制的纯文字富文本查询，见 [任务进度](docs/task-progress.md)；M6 本人私聊的概览、历史详情及同卡片刷新已验收 |
| P1 检查后恢复 | 已登记本人兼审批人可在私聊用 `/recover` 查看并确认检查；诊断版本补充进程、队列和 Hub 事实，范围见 [恢复边界](docs/usage.md#p2检查后恢复p1-网关) |
| P1 排队管理 | 已登记本人兼审批人可用 `/queue` 查看未开始的请求，并用 `/withdraw 完整请求编号` 或引用原任务发送 `/withdraw`；已取得执行授权的任务不能撤回 |
| P1 可选项目验证 | 私有配置登记 profile 后，本人可用 `/verify profile 任务` 显式选择 UI-eval 验证；原生任务、验证、review、发布分开，部署和验收见 [项目验证](docs/project-verification.md) |
| P1 有界修复 | repair-enabled profile 支持 `/verify-repair profile 任务`，明确功能断言失败后最多追加一轮修复；M6 本人 fixture 的两轮闭环、审批按钮与历史查询已验收，[使用与边界](docs/bounded-repair.md) |
| P1 验证线索 | 本人兼审批人可在登记私聊用 `/findings` 只读汇总最近验证任务的非通过线索；按 profile 取最新记录，不启动模型或自动修复，见 [查询范围](docs/usage.md#验证线索p1-网关)；M6 本人 fixture 查询及记录/证据未变已验收，见 [实际记录](docs/live-acceptance.md) |
| 浏览器权限阻塞 | 本人私聊可查看结构化拒绝与本机处理指引；处理后用 `/browser-retry 编号 local-change-confirmed` 请求一次关联续接，权限仍由浏览器实际校验；M6 本人历史拒绝查看与一次关联续接已验收，见 [边界](docs/browser-access.md) |
| Codex 审批 / 提问 | 支持命令与文件请求审批、单个非敏感问题；同一审批人私聊可点击批准本次 / 拒绝；原生提供有效前缀建议时，“批准并记住”独占一行并先展示用户级范围；其他范围保留英文命令 |
| 结果发送 | 统一飞书富文本排版；系统结果按结论、状态与可复制详情分区，持久化重试；重试结果不会重跑任务 |
| 以本人身份主动发消息 | 可通过另行配置的飞书 CLI 用户授权实现；不是 bridge 的内置发送模式，见 [工具与身份](docs/integrations.md) |

图片是**参考上下文**，直接发送图片不会启动任务。文件、音频、视频、交互卡片、置顶文档、会议纪要链接等不会自动展开。支持的图片格式、数量、字节和下载时间限制以 [context-limits.ts](src/context-limits.ts) 为准。

## 系统关系

```mermaid
flowchart LR
    F[飞书私聊或群内 @机器人] <--> S[飞书 SDK 长连接]
    S <--> B[本地 bridge]
    B <-->|stdio JSON-RPC| C[本地 codex app-server]
    C --> P[登记项目 / 本地规则 / 已配置工具]
```

不需要公网 Webhook、开放本地端口或额外部署模型服务。运行电脑要保持唤醒和联网；模型调用仍会产生所选 Codex 服务对应的用量。

分身可使用运行账号可访问的 Codex 配置、项目 `AGENTS.md`、Skills 和工具；**不会自动复制当前桌面聊天的上下文或过去所有对话经验**。希望长期沿用的习惯、项目经验和工作流程，应记录在可被 Codex 读取的规则、文档或 Skills 中。

命令使用英文小写，发送 `/help` 查看当前入口支持的命令；例如 `/recover`、`/steer`、`/approve`、`/queue`、`/withdraw`。机器人说明和普通对话可继续使用中文。旧中文 slash 命令不再执行。

## 文档入口

| 文档 | 读者与内容 |
| --- | --- |
| [安装说明](docs/installation.md) | 部署者：环境准备、下载、身份登记、启动、首次验收、更新 |
| [配置说明](docs/configuration.md) | 部署者：全部字段、默认值、个人 / 团队模板、上下文开关 |
| [飞书应用设置](docs/feishu-setup.md) | 应用管理员：权限、长连接订阅、发布、头像、可用范围 |
| [使用说明](docs/usage.md) | 同事：发任务、选项目、开发 / PR / Review 示例、命令、审批 |
| [工具与身份](docs/integrations.md) | 部署者：Codex、GitHub、飞书 CLI、用户授权与应用身份 |
| [常见问题](docs/troubleshooting.md) | 部署者 / 同事：不回复、读不到前文、图片、版本、授权、恢复 |
| [运行维护](docs/operation.md) / [运行验收与恢复演练](docs/operational-readiness.md) | 维护者：服务、闭合备份、隔离恢复、待执行的登录/唤醒/断网演练 |
| [架构](docs/architecture.md) / [团队访问](docs/team-access.md) | 开发者：实现与访问控制细节 |
| [Agent 系统方案](docs/agent-system-plan.md) / [P0 执行探针](docs/autoloop-p0.md) / [OpenSpec 工作流](openspec/README.md) | 维护者：阶段规划、隔离验证与一个 M6 实例的 owner 私聊验收及恢复边界 |
| [P1 交接方案与组件](openspec/changes/archive/2026-11-16-integrate-feishu-autoloop-handoff/README.md) | 维护者：持久化接单、原生执行、控制转发和结果投递组件；迁移与回滚工具已通过临时数据演练，已完成限定范围的 owner 私聊验收 |
| [实施状态](docs/implementation-plan.md) / [真实验收记录](docs/live-acceptance.md) | 维护者：已实现、已观察、待验收的区别 |

## 配置与授权

`.env` 放**本部署**的飞书应用凭据；`bridge.config.json` 放允许的使用者、审批人、租户、项目目录和上下文范围。提供两个全字段模板：

- [团队模板](bridge.config.example.json)：指定租户、开启群聊，仍需替换应用范围内的真实 IDs。
- [个人模板](bridge.config.personal.example.json)：白名单、私聊优先；新部署可先用它验证，再开启团队使用。

模板都关闭群聊前文和图片。开启前文需要额外的飞书群消息权限；后台权限比运行时的 24 小时 / 50 条限制更宽。配置与授权的对应关系见 [配置说明](docs/configuration.md) 和 [飞书应用设置](docs/feishu-setup.md)。

任务由部署者的本地 Codex 环境执行。用户会话分离，但项目文件、主机凭据和工具不是按同事隔离的；群内答案对群成员可见。bridge 仅转发 Codex **实际提出**的审批请求，不能保证所有修改、发送、push 或发布都经过额外审批。工作授权和 PR / 合并 / 发布规则需要写入项目规则并配合相应工具权限；需要严格隔离时应使用独立运行账号、凭据和环境。

## 验证与状态

```bash
npm run check       # 类型检查、行为测试和生产构建；不向飞书发消息
npm run smoke:codex # 真实本地协议握手；不发起推理任务
```

GitHub Actions 使用 Node.js 24 运行无外部凭据的检查。已观察到一个 macOS 部署的应用连接、身份登记、群消息收发、只读项目任务、前文 API、独立图片推理与表情 API；M6 owner 私聊已验证命令批准、拒绝和执行器故障后的检查恢复及原会话续接；同事账户与新图文交互仍待独立验收。Linux CI 验证了模拟行为，Linux / Windows 的完整真实部署未作普遍验证；一个 macOS 部署已观察到后台服务安装、连接和正常退出后的重启；后台配置另有生成脚本，新部署仍需自行安装与验收。

M6 owner 私聊还已验证 P2 的飞书恢复查看、本人提交检查依据、网关重启后的决定与回执去重，以及原会话续接。只读诊断报告已验证能展示仍运行的登记进程、队列和 Hub 状态，查看不会解除保护；检查后恢复由本人另行确认。进程后代与实际副作用由人工核对；缺少封存证据或存在未执行队列时仍需本机维护。详见 [真实验收记录](docs/live-acceptance.md)。

M6 owner 私聊已真实验证英文 `/queue` 和按完整编号 `/withdraw`：撤回发生在执行授权前，恢复 Worker 后该任务以 `nothing` 收尾，始终没有启动 Codex；网关重启保留决定与唯一回执，队列为空，新消息继续原会话。本次用临时 Hub-only 模式保留排队窗口，已还原正常配置；另有任务运行时撤回排队项的隔离、引用原消息撤回仍只有自动化覆盖。其他英文命令与同事/群交互保留独立验收范围。

Codex 在创建和恢复会话时能看到已登记项目别名与当前选择；业务数据查询先核对选中项目的数据源和统计口径。不支持的交互由 bridge 拒绝，详细方法与原因留在 `/status` 和日志；聊天里只给最终答复，不显示工具参数。

现有桌面会话同步、每位同事的飞书 OAuth 映射、自动任务重放和数据定期清理尚未实现。休眠期间消息不保证补收；结果投递跨飞书去重窗口可能重复。新部署需完成自己的真实验收。

## 开发与参考

维护指引在 [AGENTS.md](AGENTS.md)。使用 topic branch 与 PR，升级 Codex 协议时重新生成并验证绑定。

- [Codex CLI](https://developers.openai.com/codex/cli/) / [app-server](https://learn.chatgpt.com/docs/app-server)
- [飞书 Node SDK](https://github.com/larksuite/node-sdk) / [消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [飞书 CLI](https://github.com/larksuite/cli)

群内成员提及使用消息提供的姓名；身份未知时明确说明。用户引用的原回复会独立读取、优先传入，并与有限群历史去重；引用不构成执行或审批授权。

答案回复原提问，普通答案隐藏任务编号。支持明确的自然补充/停止、简洁状态与 `/status details`、本次动作审批和 `/answer 编号 内容`。本群 `/notify @成员 内容` 使用本条消息真实选择的成员；分工建议不等于通知或指派。`npm run metrics` 只读本地耗时汇总，不上传内容；owner 私聊的命令审批和回复关联已有真实验收；同事审批与群通知仍需端到端验收。

可选的 `登记别名：具体需求` 前缀会直接选择项目，减少一次模型分类；普通自然提问仍按原流程判断，不需要学习前缀。
