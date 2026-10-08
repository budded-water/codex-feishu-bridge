# 飞书应用设置

面向每位新部署者。使用自己的应用、租户和用户 IDs；已有实例的验收记录不替你完成授权。安装顺序见 [安装说明](installation.md)。

## 应用与机器人

在 [飞书开发者后台](https://open.feishu.cn/app) 创建企业自建应用，启用机器人能力。应用名称和图标自行选择；App ID 与 App Secret 填本机 `.env`。不要把真实凭据复制到 public 配置模板。

应用可用范围必须包含实际使用者；群聊使用时还要把机器人加入目标群。机器人能被谁发现、飞书 API 能访问什么、bridge 允许谁提交任务，是不同配置层，都需要匹配。

## 按功能开权限

下面列出当前 bridge 使用的权限，后台名称可能本地化；以接口文档和控制台要求为准。选取对应的**应用身份**权限，不用 CLI 的 user OAuth 来替代机器人权限。

| 功能 | 对应 scope / 条件 |
| --- | --- |
| 私聊收到文本 | `im:message.p2p_msg:readonly` 与消息接收事件 |
| 群里用户 @此机器人 | `im:message.group_at_msg:readonly`；机器人在群内；enableGroups=true |
| 机器人发送最终答案 | `im:message:send_as_bot`（或发送接口接受的等效 grant） |
| 添加、删除接收表情 | `im:message.reactions:write_only`，或接口接受的 `im:message` |
| 表情重试 / 重启时查本应用记录 | `im:message.reactions:read`，或接口接受的 message-read grant |
| 可选群历史 / 引用 / 图片资源 | `im:message:readonly` 或接口支持的等效读取 grant；群前文还要求 `im:message.group_msg` 及群成员身份 |

群模式启动时通过 bot-info API 验证机器人的 open ID。bridge 只接受核对后的真实 @mention，不依赖机器人名字，也不需要开启其他机器人发来的 @消息。

**群前文权限是可选的敏感范围。** `im:message.group_msg` 的平台授权可读取关联群消息，比程序约束的“触发群、触发前 24 小时、最多 50 条记录”宽。部署者同意这个平台范围后再申请；只用 @接收不要求开启它。模板保持前文 / 图片关闭。

引用单条消息与图片资源也需要所调用读取接口的权限，不要从“关闭自动历史”推断完全不读取被明确引用的资料。图片参考不需要额外云文档授权。

[消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[历史消息](https://open.feishu.cn/document/server-docs/im-v1/message/list)、[表情添加](https://open.feishu.cn/document/server-docs/im-v1/message-reaction/create)、[官方 Node SDK](https://github.com/larksuite/node-sdk)。

## SDK 长连接与发布

1. 填 `.env`，在本机保持 `npm run identify` 运行；它会连接 SDK 并打印登记挑战。
2. 进入事件 / 回调设置，选择 **SDK 长连接**接收模式，订阅 `im.message.receive_v1`。保存时平台可能要求已有 SDK 连接。
3. 创建应用版本，配置目标使用者的可用范围，按企业流程提交发布 / 审批。
4. 自己私聊机器人发送完整 `pair ...` 挑战；终端打印此应用下的 open ID、tenant key 和审批私聊 ID。挑战过期时重新运行 identify。
5. 用打印值填好本部署 JSON，再运行 doctor / check / start，验证任务。

identify 不运行 Codex、不自动回复其他消息，也不自动把所有人登记为审批人。不要把另一个应用的 CLI 用户 open ID 直接填到当前机器人配置。登记成功后身份记录仍需写进本机配置。

新增权限后按控制台所需的发布 / 审批流程操作，并通过实际 API / 聊天验证；不假定“已保存”就对线上生效。某个已观察部署曾出现权限即时生效，这不是所有新部署的通用承诺。可用范围与 bridge 的 tenant / allowlist / approvalUsers 也要同步。

## 名称与头像

在“凭证与基础信息 → 综合信息”编辑应用名称 / 图标。按控制台提示创建并发布新版本后核对机器人信息；应用列表中的新图标不代表线上聊天头像已更新。线上信息已经更新、客户端仍旧时再刷新或重新打开客户端。[官方机器人配置说明](https://www.feishu.cn/hc/zh-CN/articles/360024984973-在群组中使用机器人)

更改头像不需要改 bridge 代码；应用凭据或 JSON 配置变化则需要正常重启本地 bridge。

## 与飞书 CLI 的关系

CLI 是 Codex 可以另行使用的工具，不是这个 SDK 连接的必需依赖。CLI 可以使用同一个应用或另一个应用；bot 身份和本人 OAuth 身份各有权限、资源范围和授权条件。bridge 最终答案保持机器人身份，主动本人发送需要另配工具能力。见 [工具与身份](integrations.md)。

## 验收与排查

私聊先测 /status、讨论、项目只读任务、表情和审批；群里再验证真实 @、前文和图片。完整清单在 [安装说明](installation.md)，故障对应表在 [常见问题](troubleshooting.md)。

自动化测试、doctor 和协议 smoke 都不能证明企业后台授权、用户可用范围和真实模型任务已通过。每位新部署者完成自己的验收，保留脱敏记录。
