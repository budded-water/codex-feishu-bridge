## Why

The M6 owner-private pilot retains uncertain execution guards correctly, including across gateway restart. Releasing an inspected guard currently requires a local maintenance command, which interrupts remote use. Expose a bounded human recovery operation through the existing Feishu gateway while preserving uncertainty, execution identity and native policy.

## What Changes

- Add `/恢复` to inspect the enrolled owner's guarded unknown execution without inference or tool execution.
- Accept `/恢复 <execution-id> <inspection-reference>` only from that task's enrolled owner, who must also be a configured approval administrator in the enrolled private approval chat.
- Require a valid, request-bound sealed native checkpoint proving the native child settled, an unreachable authenticated owner, and the human's explicit process/effects inspection reference before releasing exactly that guard.
- Preserve the original unknown outcome, maintenance pause, blocked requests and revoked launch authority. Recovery does not execute or replay work.
- Persist the deciding actor/message and checkpoint-bound inspection reference through the existing recovery ledger, with repairable result delivery across gateway restart.

## Scope

This is a separate P2 delivery slice on top of P1. No model-based forensic agent, process killer, new credentials, Hub owner capability, queue replay or automatic effects verification is introduced. A settled native child does not prove that all command descendants or external effects are settled; the owner must inspect those separately. Missing sealed evidence still requires local maintenance. Existing Hub reconciliation cards are not closed by this source-scoped gateway operation.

## Impact

Changes affect pilot interactions, the existing recovery ledger, transport notice projection and public usage/maintenance documentation. Native protocol calls and configuration fields are unchanged. P1 remains independently reviewable; the implementation PR will target its unmerged branch until the P1 delivery is merged.
