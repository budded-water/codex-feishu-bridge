# Add owner matter routing

## Why

The M6 owner private chat can target an exact existing task, but ordinary tasks in a shared workspace reuse one native conversation. Independent work needs separate histories that an owner can revisit from the same chat.

## What changes

- Create, list and switch named matters in the enrolled owner private chat, including a default conversation.
- Route a new request by a verified task or matter reference, an exact matter title, a bound GitHub pull request, or the owner's explicit selection.
- Hold ambiguous inputs until the owner chooses a concrete target on a confirmed Feishu card.
- Keep one native conversation per named matter. Let the assigned runner create its thread when the first request starts.

## Impact

This adds owner-private ingress, native conversation identity and card callbacks in the managed gateway. Autoloop retains per-request dispatch and the canonical directory stays the execution resource. The feature applies to ordinary messages. Existing replay, recovery, approval and verification commands retain their source-specific contracts. Automated alert ingress and semantic model routing are outside this change.
