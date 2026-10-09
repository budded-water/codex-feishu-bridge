# Codex Feishu Bridge

把安装在你电脑上的 Codex 接到飞书，让你或同事通过私聊、群内 `@机器人` 提交工作。

它可以作为本地 Codex 的工作分身入口：在已登记的项目中分析问题、实现功能、修复 Bug、review 代码；GitHub、资料搜索、飞书工具等工作由本机 Codex 已配置的工具完成。模型推理仍使用 Codex 的模型服务，可通过 `codexReasoningEffort` 单独设置 bot 的推理强度，本地文件操作在运行桥接程序的电脑上执行。

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

| 功能 | 当前行为 |
| --- | --- |
| 私聊 / 群聊入口 | 接收人类发送的文本；群里必须真实 `@` 此机器人，普通群消息不触发工作 |
| 普通讨论 | 普通聊天直接回答；明确项目任务由 Codex 选择已登记项目，有歧义时提问；`/project` 可手动指定 |
| 功能开发 / Bug 修复 / Review | Codex 在登记的本地目录执行，沿用本机配置、工具和授权策略 |
| 提交分支 / 开 PR / 查资料 | 取决于本机 Codex 的相关工具、登录状态和项目规则；bridge 不自带 GitHub 或搜索账号 |
| 群聊前文 | 单页读取触发消息之前 24 小时内最多 50 条记录；默认关闭；明确引用单条消息可走引用模式 |
| 图片参考 | 可选读取前文或引用中的独立图片 / 富文本图片，作为真实 Codex 图片输入；最多 8 次尝试，默认关闭 |
| 会话与排队 | 按租户、用户、聊天、项目分会话；同一真实目录串行，不同目录可以独立执行 |
| 接收反馈 | 原消息添加 `OnIt` 表情；排队有说明；等待期间保持安静，只有需要确认时提问；最终答案单独发送 |
| 运行控制 | `/status`、`/补充`、`/stop`、`/clear`、`/new` |
| Codex 审批 / 提问 | 支持命令与文件请求审批、单个非敏感问题；管理员可在指定私聊回复 |
| 结果发送 | 以应用机器人身份发送飞书富文本，持久化重试；重试结果不会重跑任务 |
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

## 文档入口

| 文档 | 读者与内容 |
| --- | --- |
| [安装说明](docs/installation.md) | 部署者：环境准备、下载、身份登记、启动、首次验收、更新 |
| [配置说明](docs/configuration.md) | 部署者：全部字段、默认值、个人 / 团队模板、上下文开关 |
| [飞书应用设置](docs/feishu-setup.md) | 应用管理员：权限、长连接订阅、发布、头像、可用范围 |
| [使用说明](docs/usage.md) | 同事：发任务、选项目、开发 / PR / Review 示例、命令、审批 |
| [工具与身份](docs/integrations.md) | 部署者：Codex、GitHub、飞书 CLI、用户授权与应用身份 |
| [常见问题](docs/troubleshooting.md) | 部署者 / 同事：不回复、读不到前文、图片、版本、授权、恢复 |
| [运行维护](docs/operation.md) | 维护者：前台进程、macOS launchd、数据、重试、日志 |
| [架构](docs/architecture.md) / [团队访问](docs/team-access.md) | 开发者：实现与访问控制细节 |
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

GitHub Actions 使用 Node.js 24 运行无外部凭据的检查。已观察到一个 macOS 部署的应用连接、身份登记、群消息收发、只读项目任务、前文 API、独立图片推理与表情 API；完整同事账户、审批和新图文交互验收仍有待完成。Linux CI 验证了模拟行为，Linux / Windows 的完整真实部署未作普遍验证；一个 macOS 部署已观察到后台服务安装、连接和正常退出后的重启；后台配置另有生成脚本，新部署仍需自行安装与验收。

Codex 在创建和恢复会话时能看到已登记项目别名与当前选择；业务数据查询先核对选中项目的数据源和统计口径。不支持的交互由 bridge 拒绝，详细方法与原因留在 `/status` 和日志；聊天里只给最终答复，不显示工具参数。

现有桌面会话同步、每位同事的飞书 OAuth 映射、自动任务重放和数据定期清理尚未实现。休眠期间消息不保证补收；结果投递跨飞书去重窗口可能重复。新部署需完成自己的真实验收。

## 开发与参考

维护指引在 [AGENTS.md](AGENTS.md)。使用 topic branch 与 PR，升级 Codex 协议时重新生成并验证绑定。

- [Codex CLI](https://developers.openai.com/codex/cli/) / [app-server](https://learn.chatgpt.com/docs/app-server)
- [飞书 Node SDK](https://github.com/larksuite/node-sdk) / [消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [飞书 CLI](https://github.com/larksuite/cli)

群内成员提及使用消息提供的姓名；身份未知时明确说明。用户引用的原回复会独立读取、优先传入，并与有限群历史去重；引用不构成执行或审批授权。

答案回复原提问，普通答案隐藏任务编号。支持明确的自然补充/停止、简洁状态与 `/status 详情`、本次动作审批和 `/回答 编号 内容`。本群 `/通知 @成员 内容` 使用本条消息真实选择的成员；分工建议不等于通知或指派。`npm run metrics` 只读本地耗时汇总，不上传内容；新交互的真实审批、通知与回复关联仍需端到端验收。

可选的 `登记别名：具体需求` 前缀会直接选择项目，减少一次模型分类；普通自然提问仍按原流程判断，不需要学习前缀。
