# SLS 商家退款只读观测

这是独立运行的一条告警试点。它用 SLS 告警执行历史发现事件，用恢复 Job 和积压 Job 的日志采证。处理结果和观察进度保存在独立的本机 SQLite 目录。每次调用执行一轮，适合先做脱敏回放和受控生产观察。

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

新的事件在创建时观察一次，并保留 5 分钟和 15 分钟两次复查时间。进程重启后从原事件继续。错过的观察按最近到期的一次处理。两次复查需要不同批次、后于最后一次触发的健康证据。最终取证截止点由已读取的告警历史和新鲜的 `inactive` 评估共同限定，满足条件才转为 `resolved`。最终未能确认恢复时，报告为 `needs-attention`，保留人工处理所需的记录。补读到已被较新健康证据覆盖的旧触发时，只留评估记录。如果迟到的触发或同一时点的冲突评估使结案证据失效，原事件转回人工处理。更晚事件的复查预算继续保留，最近十条待人工处理的事件列在报告的 `handoffs` 字段。

## 当前交付范围

本地回放和一次有界生产只读观察分别验收。只读生产观察核对了已登记规则、历史评估、恢复状态及积压样本的实际格式。真实观测保存在本机私有目录。此入口独立于现有 M6 网关，持续调度、机器来源接单、Codex 续接和飞书通知是 [OpenSpec](../openspec/changes/add-sls-refund-observer/tasks.md) 的后续交付。
