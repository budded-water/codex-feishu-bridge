# Owner task progress

## Why

Remote owners currently need separate status, queue and verification commands and cannot browse every ordinary task. Add one read-only view over the existing identities and execution facts before expanding autonomous work.

## What changes

Add enrolled-owner-private `/tasks [page]` and `/task <execution UUID>`. Group and paginate existing tasks, show evidence-qualified ordinary/verification/repair progress, and deliver detail snapshots as refreshable Feishu cards. Keep existing approval cards and quoted stop/steer controls; bind detail replies to the original task.

## Scope

No model summarization, percentage estimation, new task store, scheduler, task admission or automatic replay. Read-only authenticated native progress must not run snapshot cleanup or mutate journals. Query/callback receipt and durable answer/update commit together. Runtime/test delivery and actual owner transport acceptance remain separate.
