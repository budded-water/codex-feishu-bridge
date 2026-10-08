# 安装说明

这份说明供希望在**自己的电脑**运行 Codex 分身的人使用。只是向同事已经运行的机器人发任务，无需安装；直接读 [使用说明](usage.md)。

## 1. 准备环境

| 要求 | 检查方式 | 说明 |
| --- | --- | --- |
| Git | `git --version` | 下载项目、操作登记仓库 |
| Node.js 24 或更高版本及 npm | `node --version`、`npm --version` | bridge 使用 Node 内置 SQLite |
| Codex CLI | `codex --version` | 必须与 src/codex/generated/version.ts 完全匹配 |
| Codex 身份 / 模型访问 | `codex login status`；在一个自有项目中做一次简单本地对话 | bridge 沿用本机 Codex 登录和配置 |
| 飞书企业自建应用权限 | 可在开发者后台创建、配置并发布应用 | 应用可用范围需要覆盖使用者 |
| 一个本地项目目录 | 本机实际存在的绝对路径 | 当前配置即使主要用于讨论，也至少要求登记一个目录 |
| 常驻电脑和网络 | 可访问飞书及 Codex 所用服务 | 电脑休眠时无法持续接收任务 |

真实前台运行与服务生成已在 macOS 观察。Linux 有无凭据 CI 检查，完整 Linux / Windows 实际部署仍需使用者验证；下列终端命令按 macOS / Linux shell 编写。Windows 使用匹配版本的 Codex 与 Node 时需自行验证路径、终端和运行方式，没有内置 Windows 服务安装器。

## 2. 下载并安装依赖

默认 `main` 分支包含完整实现，常规安装使用它：

```bash
git clone https://github.com/budded-water/codex-feishu-bridge.git
cd codex-feishu-bridge
npm ci
```

若试用尚未合并的后续 PR，在 clone 时加 `--branch <该 PR 的分支>`；不要把分支中的未发布能力当作 main 已有功能。

本项目没有发布到 npm。`npm ci` 安装 bridge 依赖，不会替你创建飞书应用、登录 Codex 或授权飞书 CLI。

如尚未安装兼容的 Codex，可以从仓库的版本常量读取要求后安装：

```bash
CODEX_RELEASE=$(node --import tsx --input-type=module -e "import { CODEX_VERSION } from './src/codex/generated/version.ts'; process.stdout.write(CODEX_VERSION)")
npm install -g "@openai/codex@$CODEX_RELEASE"
codex login
codex login status
```

这条 npm 命令会变更全局 Codex 版本。已有不同版本的工作环境，应先决定采用兼容版本还是维护升级 bridge 的协议绑定；不要只删掉版本检查。其他模型提供者的登录与配置遵循自己的 Codex 配置。[Codex 安装和登录](https://developers.openai.com/codex/cli/)

## 3. 复制本部署的配置

个人先验证：

```bash
cp .env.example .env
cp bridge.config.personal.example.json bridge.config.json
chmod 600 .env bridge.config.json
```

团队部署可改用：

```bash
cp bridge.config.example.json bridge.config.json
chmod 600 bridge.config.json
```

以上两种 JSON 只选一种，避免覆盖已填好的配置。所有模板占位值必须替换；真实凭据、IDs、目录和授权文件不应提交到 git。

## 4. 创建应用并填写 `.env`

在 [飞书开发者后台](https://open.feishu.cn/app) 创建企业自建应用，启用机器人，取出自己的 App ID 和 App Secret，填写 `.env`：

```dotenv
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
```

使用本机编辑器填写密钥，不发到群聊。已有飞书 CLI 应用也可以作为接口身份，但多个 bridge 不应同时消费同一个机器人应用；独立部署推荐独立应用，便于路由和维护。应用名称和图标自行选择。

## 5. 连上 SDK、配置事件并登记部署者

打开一个终端保持运行：

```bash
npm run identify
```

它只连接飞书、打印一次性的 `pair ...` 挑战，不运行 Codex、不发聊天回复，也不要求 JSON 模板已填完。保持此连接，按 [飞书应用设置](feishu-setup.md) 完成所需权限、`im.message.receive_v1` 事件和 **SDK 长连接**模式；发布应用并把自己加入可用范围。

在飞书私聊该机器人，发送终端打印的**完整挑战**。终端随后打印：

- 当前应用下你的 open ID → `allowedUsers` 和 `approvalUsers`。
- tenant key → 团队模式的 `allowedTenant`，个人也可固定它。
- 你的机器人私聊 chat ID → `approvalChat`。

登记完成后进程退出。挑战 15 分钟过期；配置应用耗时太久时，重新运行 identify 并发送新挑战。不要把另一个应用的 open ID 填进来；挑战由谁发送就登记谁，因此不要分享挑战。

## 6. 填写项目和访问范围

修改 `bridge.config.json`，登记本机**已经存在**的项目目录，键名是同事使用的别名：

```json
"projects": {
  "web": "/absolute/path/to/your/web-project",
  "api": "/absolute/path/to/your/api-project"
}
```

上面是 JSON 文件中的字段片段，不是独立可运行配置。替换为自己的绝对路径；`~` 和环境变量不会自动展开。个人 / 团队模式、审批与上下文开关见 [全部配置说明](configuration.md)。先验证个人访问，再扩大团队范围。

## 7. 检查、构建与运行

```bash
npm run doctor
npm run check
npm run smoke:codex
npm start
```

| 命令 | 能验证什么 | 不能证明什么 |
| --- | --- | --- |
| `doctor` | 私有 JSON、凭据存在、项目目录、Codex 版本 | 飞书权限、OAuth、模型能完成推理 |
| `check` | 类型检查、模拟行为测试、编译产物 | 新应用的真实收消息和授权配置 |
| `smoke:codex` | 本机 app-server 初始化和模型目录 | 实际推理 / 工具执行能力 |
| `start` | 启动实际 bridge、Codex 与飞书连接 | 仍需聊天任务完成真实验收 |

`check` 包含构建，因此不需要紧接着重复 `npm run build`。未做 check 时单独 `npm run build` 后才能 `npm start`。成功连接会在终端显示 `Feishu connection ready`；保持进程运行。Ctrl-C 可正常停止。`npm run dev` 是源码调试入口。

## 8. 首次验收

先私聊机器人：

1. 发 `/status`，确认能收到回复。
2. 发 `/chat`，再问一个简短讨论问题，确认收到表情和最终答案。
3. 发 `/project web`，再让它“只读地概述项目结构”，确认目标目录正确。
4. 做一次本机策略会提出审批的受控任务，验证 `/拒绝`、指定管理员和审批超时；审批请求是否出现取决于 Codex 策略。
5. 如果启用群聊，将机器人加入群，输入真实 `@机器人 /status`；普通文字不会触发任务。
6. 需要前文 / 图片时，先开相应权限和配置，再在群里发送资料，随后 `@机器人` 提问，检查它引用了实际内容。

上线前由第二位同事验证独立会话、项目权限和审批路由。表情添加 / 清理、长等待提示、富文本与停止控制也需在实际客户端验收。参见 [使用说明](usage.md)、[常见问题](troubleshooting.md)。

## 9. 后台常驻和更新

macOS launchd 文件由 `npm run service:print` 生成，需要人工检查、安装和激活，见 [运行维护](operation.md)。前台与后台不能同时占用同一状态目录。服务不会让休眠电脑自动保持唤醒。

更新前先让运行任务结束，正常停止前台进程或卸载后台实例，备份本部署的私有配置及状态，然后：

```bash
git pull --ff-only
npm ci
npm run check
npm run doctor
```

确认兼容再 `npm start`；协议改变时另做 smoke 和升级验证。不要把 `.env`、JSON 或数据库替换成别人的文件。重启不会自动重跑未完成的任务；先确认仓库 / 外部操作的实际结果，再明确发起新任务。

本项目只要求本部署自己的 Codex 和飞书应用；GitHub、搜索、飞书 CLI 等是按任务需要另配的工具，见 [工具与身份](integrations.md)。
