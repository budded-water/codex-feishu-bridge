# SLS 商家退款只读观测

这是针对单条商家退款告警的只读观测。它用 SLS 告警执行历史发现事件，用恢复 Job 和积压 Job 的日志采证。处理结果和观察进度保存在独立的本机 SQLite 目录。每次调用执行一轮，适合先做脱敏回放和受控生产观察。

## 脱敏回放

在仓库内用 Node 24 执行：

```sh
state_dir=$(mktemp -d /tmp/refund-replay.XXXXXX)
npm run sls:refund -- replay "$state_dir" test/fixtures/sls-refund-replay.json
```

样本借鉴用户提供的退款告警。时间、规则与事件 ID、诊断数据和恢复样本均为合成输入。回放结果显示同一事件、初步诊断和两次复查。自动测试会在每一帧物理重开 SQLite，并覆盖重复、迟到、条件重叠、查询不完整、不同 Job 批次和监控停止。

## 只读观察

在私有目录准备 JSON，将示例中的项目、规则、时间、可执行文件路径和已有 CLI profile 换成已核对的值。起点是 UTC Unix 秒，使用短的回看窗口并保留同一配置和状态目录。Replay 和生产观察各自使用独立目录。

```json
{
  "region": "cn-hangzhou",
  "project": "example-observability",
  "rule": "example-merchant-refund-rule",
  "start": 1700000000,
  "executable": "/absolute/path/to/aliyun",
  "profile": "example-readonly"
}
```

```sh
npm run sls:refund -- observe /absolute/path/to/private-state /absolute/path/to/source.json
```

观察命令通过已登记 Aliyun CLI profile 向指定 Project 的 `internal-alert-history` 和 `service-runtime` 发出固定 `GetLogsV2` 查询。实际规则 ID 用 `GetAlert` 核对。运行所需的日志权限仅覆盖两个目标 Logstore 的日志读取。两个日志库缺访问权限时，保留现有云端权限决定并报告阻塞。参见 [告警执行历史](https://help.aliyun.com/zh/sls/fields-in-alert-rule-evaluation-logs) 和 [GetLogsV2](https://help.aliyun.com/zh/sls/developer-reference/api-sls-2020-12-30-getlogsv2)。

告警历史默认留一分钟写入延迟，两分钟重叠补读，每次最多前进十五分钟。响应达到行数上限、结果不完整或规则身份不匹配时，命令退出，读取进度停在上一个完整窗口。重复评估按 `AlertID` 去重，事件按记录的触发顺序关联。告警历史读失败时 CLI 明确报错。诊断日志读失败、响应不完整或缺少样本时，复查记录用固定原因区分这些情况。

## 诊断与结束条件

| 输出 | 可据此判断的范围 |
| --- | --- |
| `aged-backlog` | 最新完整范围内有超过 15 分钟的积压。年龄沿用业务监控的 `created_at` 口径。 |
| `missing-channel-identity` | 当前范围内存在缺渠道身份的请求。这一项可与超时同时出现。 |
| `recovery-job-unhealthy` | 最新可用终态有查询错误、推迟项，或恢复 Job 以其他非正常结果结束。 |
| `unavailable` | 样本过期、缺失、范围不一致或不完整，需要更多证据。 |

采证使用同一积压 Job 批次的两渠道记录和一条新鲜的恢复 Job 终态。不同批次的数据不能组合。聚合计数可以证明当前范围的现象，具体退款为何失败仍需另外取证。

新的事件在创建时观察一次，并保留 5 分钟和 15 分钟两次复查时间。进程重启后从原事件继续。错过的观察按最近到期的一次处理。两次复查需要不同批次、后于最后一次触发的健康证据。最终取证截止点由已读取的告警历史和新鲜的 `inactive` 评估共同限定，满足条件才转为 `resolved`。最终未能确认恢复时，报告为 `needs-attention`，保留人工处理所需的记录。补读到已被较新健康证据覆盖的旧触发时，只留评估记录。如果迟到的触发或同一时点的冲突评估使结案证据失效，原事件转回人工处理。转人工后若读到明确的 inactive 评估，且已有更晚的起警，则创建独立事件重新复查。重叠补读发现迟到的 inactive 时也适用。各事件的复查预算独立，最近十条待人工处理的事件列在报告的 `handoffs` 字段。

## 网关定时观测

在 M6 的私有 `HANDOFF_CONFIG` 中加入可选的 `slsRefundObserver` 对象，字段与上面的生产观察 JSON 相同。未配置时，网关不运行观察。启动前核对部署账号在无人值守环境可使用该 profile、只具备已登记日志读取权限，并选择短回看窗口。网关使用独立的 `<pilot-state>/sls-refund/refund-observer.db`，单次命令使用另一目录。保持来源配置、已读时间和关联的聊天状态一起保留。

没有配置订阅时，网关连接飞书后开始首轮，上一轮结束后间隔两分钟。原有观测使用首次发现、约 5 分钟和约 15 分钟三个采证点，具体采样受轮询、入库延迟和主机状态影响。重新启动后从 SQLite 保留的进度读起。补读未追上当前窗口期间不投递新卡。告警查询失败记录固定错误，原有飞书功能继续工作。维护暂停期间不启动新查询或投递新卡，关闭时等待进行中的查询结束。

首次启用后，在目标本人私聊发送一次 `/status`，让网关从真实消息确认聊天、租户及操作者。只有该记录已确认才会投递，重启会沿用记录。每个事件用一个飞书事项。首次观察、证据确认恢复或需要人工核对时，网关将当前结果发给绑定的本人私聊。卡片仅展示聚合计数与观测时间。重复读取、投递重试和网关重启沿用已有投递身份。尚未入队的旧状态可由更新的状态取代。按 `/matters` 查看，点卡片可切换，或直接回复该卡。回复会带上该卡的历史证据，并在同一事项中启动或续接 Codex。自动观测本身不启动模型、执行退款或修改生产。旧卡代表该次观测时间的状态。卡片投递身份待确认时，无法识别的引用会提示用户重发。

停用时从私有配置移除 `slsRefundObserver` 后按正常网关流程重启。备份和迁移时保留稳定的观察库、`handoff.db` 和 `transport/bridge.db`。回滚归档会保留观察库，迁移到旧入口后使用兼容网关才能继续显示事项卡片。

## 订阅 SLS 起警事件

私有 `slsRefundObserver` 增加 `smq` 后，网关等待专用队列的消息。收到新起警后读 SLS 取证，随后沿用同一事件的复查和飞书事项。停机期间保留的消息使用原始起警时间。首次采样的复查时钟在日志补读追上目标后启动，已经取样的事件继续沿用原时间表。已完成的日志读取位置只有在完整读完窗口后才前进。空闲期后的首轮跳过远处的空闲历史，事件复查开始后保持已有读取范围的连续性。此前事件转人工时，新起警也会从原位置补读以辨别两个周期。

确认恢复后，网关保留一次约两分钟后到期的结案窗口复读。重启后仍可完成这次复读，有冲突的迟到评估会把原事件转回人工核对，并保留区分后续事件所需的未读历史。没有待处理通知、到期复查或结案复读时，空队列响应不触发 SLS 查询。队列读取位置与观察库的原有源记录分开保存，兼容旧版观察器打开该库。退出订阅模式后，普通轮询从已记录的 SLS 游标继续。

SLS 行动策略增设 EventBridge 渠道。保留原邮件行动和触发条件。如果当前行动策略被多条规则共用，将新增通知限制到已核对的退款规则。EventBridge 用下面的模式匹配，投递完整 CloudEvent 到同地域的普通 SMQ 专用队列。通知模板的 `data` 使用六个字段，分别是账号 `aliuid`、地域 `region`、项目 `project`、规则 `alert_id`、状态 `status` 和秒级起警评估时间 `alert_time`。这些字段在 SLS 默认 EventBridge 模板中已有，专用模板可只保留六项。

```json
{
  "source": ["acs.sls.alert"],
  "specversion": ["1.0"],
  "type": ["sls:AlertEvent:Firing"],
  "data": {
    "aliuid": ["1234567890123456"],
    "region": ["cn-hangzhou"],
    "project": ["example-observability"],
    "alert_id": ["example-merchant-refund-rule"],
    "status": ["firing"]
  }
}
```

在现有 `slsRefundObserver` 对象内追加下列字段。选择在启用发送之前记录的 `start` 时间，将实际队列、账号和角色保存在私有配置中。

```json
{
  "smq": {
    "account": "1234567890123456",
    "name": "example-refund-alerts",
    "profile": "example-assume-queue-role",
    "roleArn": "acs:ram::1234567890123456:role/example-refund-queue-consumer"
  }
}
```

`smq.profile` 只需获准 AssumeRole 到已登记的消费角色。网关附加队列级临时会话策略，操作为 `mns:ReceiveMessage` 和 `mns:DeleteMessage`，资源为该队列的消息路径。部署前也应在角色本身限制同一操作和范围。EventBridge 投递身份单独获准向这条队列发送。临时凭据在内存中更新。观测继续用原来的 SLS profile。上线前核对实际后台续期和接收权限。

网关只消费匹配专用范围的起警。SMQ 重投使用最新接收句柄。通过范围核对的事件先与取证意图一同保存，再确认该消息。同一 EventBridge 事件重投沿用原记录。格式错误或不属于指定规则的消息保留在队列供检查，应用日志不输出消息正文或接收句柄。维护暂停开始前正在等待的消息若在暂停后返回，将由队列重新投递。

现场验收先使用隔离队列。检查真实模板字段、长轮询、单条确认、重投、接收权限和 EventBridge 的失败投递策略。随后核对生产规则的邮件行动、保存原配置及现有网关备份，再进行已授权切换。保留首次真实告警投递和本人回复续接的证据。退回独立日志补查可使用 `sls:refund observe` 和单独的私有状态目录。停用托管观测时移除整个 `slsRefundObserver` 配置。保留队列和本地观察记录，后续可按队列保留期继续消费。

参考 [SLS EventBridge 集成](https://help.aliyun.com/zh/sls/handle-sls-alarm-via-event-bus)、[默认模板](https://help.aliyun.com/zh/sls/default-alert-templates)、[队列目标](https://help.aliyun.com/zh/eventbridge/user-guide/route-events-to-simple-message-queue-formerly-mns) 和 [SMQ 权限](https://help.aliyun.com/en/mns/permission-policies-and-examples)。

## 当前交付范围

本地回放和有界生产只读观察已分别验收。隔离队列验证了通知契约和消费权限。生产试点在 M6 验证了通知消费、真实本人私聊卡片投递、事项切换和引用续接。观测与投递证据保存在私有部署清单，公开记录见 [M6 验收](live-acceptance.md#2026-11-19-m6-sls-refund-subscription)。机器来源自主触发 Codex 或变更生产需要另行设计。
