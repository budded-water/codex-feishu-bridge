# Feishu approval cards

## Why

The owner requested clickable approval/refusal and a clearer mobile layout. Existing posts repeat the request, internal project label and long paths before the exact action, then require typing a command. Feishu supports JSON 2.0 buttons and authenticated long-connection card callbacks.

## Scope

Add app-bound approval cards for the current same-chat private approval flow, with compact context, purpose, full redacted action, deadline and approve-once/reject buttons. Preserve polished Markdown/manual-command output for routed/group/oversized approval previews and questions. Never truncate the action to make a button fit. Callback subscription uses the existing single SDK connection; no public webhook or model-based approval manager.

Persist presentation/delivery identity and UI updates separately from native authority. Validate callback actor/tenant/chat, confirmed card message and exact native task/thread/turn/generation; reuse native request approval policy. Acknowledge callbacks promptly after durable admission, without waiting for native or platform I/O. Reject unconfirmed delivery, stale/foreign/expired/repeated decisions. Never automatically resend an uncertain native approval. Update acknowledged cards after native decisions/expiry, without claiming tool execution succeeded.

Keep a separate dependent PR above #11. Require behavioral SQLite/IPC/SDK-dispatch/restart/rollback coverage, pinned integration, complete-PR review and actual bounded owner-private button acceptance after configuring only the required callback on the existing app. Existing merge/publication boundaries remain.

## Primary references

- [Callbacks over long connection](https://open.feishu.cn/document/event-subscription-guide/callback-subscription/receive-and-handle-callbacks)
- [Card interaction behaviors](https://open.feishu.cn/document/feishu-cards/configuring-card-interactions)
- [JSON 2.0 changes](https://open.feishu.cn/document/feishu-cards/card-json-v2-breaking-changes-release-notes?lang=en-US)
