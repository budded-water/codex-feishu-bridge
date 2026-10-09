# 配置说明

本文件说明通用配置，不引用某个部署者的真实值。字段和校验以 [src/config.ts](../src/config.ts) 为准；群聊与图片限额以 [context-limits.ts](../src/context-limits.ts) 为准。

## 配置文件与环境变量

默认从**启动工作目录**读取 `.env` 和 `bridge.config.json`。复制配置后用本机编辑器填写；JSON 不允许注释、未知字段或尾随逗号。

| 环境变量 | 必填 | 作用 |
| --- | --- | --- |
| `FEISHU_APP_ID` | 是 | 本部署的应用 ID；必须为 cli_ 后接 16 位十六进制字符，与 SDK 接受格式一致 |
| `FEISHU_APP_SECRET` | 是 | 同一应用的密钥 |
| `BRIDGE_CONFIG` | 否 | bridge JSON 路径；默认 bridge.config.json；相对路径从启动目录解析 |

`stateDirectory` 则相对于 **JSON 所在目录**解析，二者基准不同。项目路径必须绝对；不展开 `~`、`${VAR}`。后台服务应以 checkout 为工作目录，使用真实 Node / Codex 路径。

本机已有环境变量优先于 `.env` 中的同名值。出现“修改文件但仍连旧应用”时检查终端 / 服务环境。模型、sandbox、Codex 登录等使用本机 Codex 配置；推理强度可用 `codexReasoningEffort` 单独覆盖此 bot；bridge 没有单独的模型 API key 或 unrestricted 开关。

## 全部 JSON 字段

“默认值”是代码在省略字段时的行为；checked-in 团队模板显式开启 tenant / groups，个人模板显式采用 allowlist / 私聊。

| 字段 | 类型 / 范围 | 必填或省略时默认 | 说明 |
| --- | --- | --- | --- |
| `allowedUsers` | 非空、不重复的 `ou_...` 数组 | 必填 | 白名单模式控制提交者；tenant 模式仍要求此字段，但不靠它限制同事 |
| `accessMode` | `allowlist` / `tenant` | allowlist | allowlist 仅名单内用户；tenant 允许固定租户的人类用户，仍受飞书可用范围限制 |
| `allowedTenant` | tenant key / null | null；tenant 模式必填 | 设定后也限制白名单模式的租户，不能是通配符 |
| `enableGroups` | boolean | false | true 才接受群里对此机器人的真实 @mention |
| `approvalUsers` | 非空、不重复的 `ou_...` 数组 | allowedUsers | Codex 命令 / 文件审批的决策者；allowlist 模式下必须是 allowedUsers 子集 |
| `approvalChat` | `oc_...` / null | null | 指定审批聊天；null 在任务聊天审批；团队推荐部署者私聊 |
| `groupContextMessages` | 整数 0–50 | 0 | 最近前文记录数；0 关闭自动前文，明确引用仍按引用预算读取 |
| `groupContextImages` | 整数 0–8 | 0 | 前文 / 引用中资源图片尝试上限；0 关闭；不能替代前文权限或消息时间 |
| `codexExecutable` | 非空字符串 | codex | 可执行名称或完整路径，不是 shell 命令；不能附带参数 |
| `codexReasoningEffort` | none / minimal / low / medium / high / xhigh / null | null | 单独覆盖此 bot 每次新请求的推理强度；null 或省略不覆盖；实际支持等级取决于所选模型 |
| `stateDirectory` | 非空路径 | .local/state | JSON 所在目录下的持久化状态；多实例必须独立 |
| `approvalTimeoutSeconds` | 整数 10–3600 | 300 | 审批 / 单个问题超时后拒绝，不能靠等待获得授权 |
| `projectRouting` | automatic / manual | automatic | Codex 判断明确项目、直接回答或澄清；manual 保留手动选项目流程 |
| `projects` | 非空 alias → 目录映射 | 必填 | 目录必须存在且绝对；别名 1–64 个字母、数字、下划线或连字符 |

`allowedUsers` / `approvalUsers` 使用**本应用对应的用户 open ID**。即使同一个人，在另一个应用下拿到的 ID 也不能直接复用。通过 [identify 登记流程](installation.md) 获取 owner、tenant 和审批聊天；登记其他用户时也要核对本应用身份。

## 个人与团队模板

个人配置：复制 [bridge.config.personal.example.json](../bridge.config.personal.example.json)。默认只接收登记用户的私聊，适合先验证或个人使用。

团队配置：复制 [bridge.config.example.json](../bridge.config.example.json)。启用 tenant 和群 @，固定企业租户，把应用发布给目标同事，审批人明确列出。`allowedUsers` 可以只保留 owner；在 tenant 模式，它不是同事准入白名单。

两个模板都需替换 IDs 与项目路径；刻意保留不可直接当真使用的占位值。`doctor` 通过才表示本机配置合法，仍不表示飞书后台权限已生效。

## 前文和图片

同意机器人读取群聊前文并开通后台权限后，可修改这两个字段：

```json
"groupContextMessages": 50,
"groupContextImages": 8
```

这是原 JSON 的字段片段。不是要求所有部署都开启；模板默认都是 0。

前文仅在授权用户触发群任务时读取当前群的一页，时间为原触发消息之前 24 小时。飞书返回页可能包含触发消息、机器人、删除记录等，过滤后**有效内容不保证有 50 条**；代码不会继续分页凑足。排队期间的新消息不算原问题的前文。

带父消息引用的任务始终单独读取并标记该引用，包含被明确引用的 Bot 回复；项目澄清回复新提供的引用也会保留，最多包含原请求和最新澄清的两条显式引用，各按自己的触发时间校验；自动前文仍以原请求时间为界。开启自动前文时，引用占用总记录预算并去重，预算不足优先最新澄清引用。`groupContextMessages: 0` 时只读取这些显式引用，最多两条；被明确引用的消息可以早于 24 小时。没引用时不自动读历史，图片数设为非零也不会凭空取得历史。

资源图片最多 8 次尝试，10 MiB / 张、20 MiB 总量，PNG / JPEG / GIF / WebP；优先最近的合规图片。下载新资源有时间预算，单个在途请求受 SDK 超时约束。图片失败保留未读说明，不把文件 key 当图片内容。此能力不等于 OCR 服务、附件解析或任意链接下载。

## 项目、会话和审批

项目别名供 `/project alias` 使用，选择属于每个用户 / 聊天；`projectRouting` 默认为 automatic：Codex 根据本次请求和已登记别名判断目标，确有歧义时提问；manual 使用手动选择流程。没有 defaultProject。两个别名指向同一真实目录时共用一条串行队列。thread 创建和恢复时只向 Codex 提供实际别名及当前选择，不提供目录清单；看到别名不等于已经选择项目。

`approvalUsers` 控制的是 Codex 已提出审批请求后的回复资格，不是“所有写操作必须审批”的总开关。你自己的 PR、push、合并和发布工作流仍由本机规则和工具权限决定。提问只允许原提交者在原聊天回答；管理员身份不能代答同事的问题。

更改配置后正常停止并重启 bridge，保留状态目录；没有热更新。切换应用需要重新核对该应用下的用户与聊天 IDs，不能只改 App Secret 就沿用另一应用的身份。

## 单独设置 bot 推理强度

在本部署的私有 JSON 中设置：

```json
"codexReasoningEffort": "low"
```

正常停止并重启 bridge 后，所有新发起的 `turn/start` 都携带这个强度，包括恢复的旧会话与路由判断；不必 `/new`。已经运行的任务不会中途改变强度。模型、身份、工具、sandbox 和审批策略仍沿用本机 Codex 配置，其他 CLI / 桌面会话不受此字段影响；不会修改 `~/.codex/config.toml`。这是部署者配置，没有聊天内切换命令。

省略或设为 `null` 时不发送强度覆盖，遵循 Codex 对该会话的继承行为；曾经覆盖过的旧会话可能保留原强度，恢复全局默认时可在空闲后 `/new`。字段合法不保证所选模型支持该等级，不支持时应调整此字段，不会自动换模型或静默降级。

图片尝试限额内优先读取最新澄清引用、原请求引用中的图片，再读取最近前文图片；未提供的图片仍明确标记为未读取。

本轮交互改动不增加配置字段，两份示例配置继续使用相同默认值。审批截止时间显示本机时区；通知固定上限以 `MAX_NOTIFICATION_MEMBERS` 为准。本地任务库记录分段时间，不向外部分析服务上传。

`别名：具体需求` 是明确选择已登记目录的可选入口，自动与手动模式都支持；普通自然提问的自动分类由 `projectRouting` 控制。该前缀代表独立新任务，会清除旧待澄清请求，并保留人工选择版本防止旧分类覆盖。
