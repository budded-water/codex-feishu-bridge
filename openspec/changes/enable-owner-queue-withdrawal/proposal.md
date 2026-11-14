# Owner-private unstarted request withdrawal

## Why

The deployed diagnostic report is read-only. An admitted but unstarted queue can prevent inspected recovery or a drained upgrade while the owner is away. The pilot currently has no remote way to retire that exact request. Native process cleanup is a separate problem: sampled PID/start-time evidence is diagnostic, not a stable process-control capability. A future cleanup feature needs execution-time supervision/containment and its own lifecycle contract.

## Scope

Add owner-private `/队列` and `/撤回` controls through the existing gateway. List bounded, owned unstarted requests; withdraw one exact request by execution ID or by replying to its original message. Commit the withdrawal and launch prohibition together, retaining an actor/message audit and original routing/block reason. Refuse once any execution permit exists. Preserve unknown guards, native history, pause and Hub runs/cards.

Use the existing SQLite database and transport notice tombstones, without model inference, new credentials or configuration. Project acknowledged withdrawal notices and terminal transport feedback after restart; require their projection and drained delivery before rollback. Preserve the audit in archived pilot state and command deduplication in reverse conversion.

## Delivery

Use a separate dependent PR above the diagnostic branch. Require actual SQLite connection/race tests, HTTP/source interleaving, ownership and transport/restart/rollback coverage, full checks, pinned Hub/Worker verification, independent review and separately recorded bounded owner-private rollout acceptance. Keep dependent PRs open pending owner merge authorization.
