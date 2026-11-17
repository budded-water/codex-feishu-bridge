# Design

## Authorities

Codex owns execution policy, reviewer decisions, persisted rules and the native denied-action authorization marker. The gateway owns enrolled identity, real message/card binding, admission and delivery. Bridge-owned records identify the exact native proposal/action and human decision; they are audit facts, not an independent runtime permission engine.

## Explicit Bot policy

A private handoff option selects read-only/workspace-write and user/auto_review, always with on-request approvals, for the enrolled owner only. Apply it explicitly at native start/resume and each ordinary/repair turn. The routing thread stays tool-disabled. Never override model, credentials, effort or unrelated local sessions. No chat message can select full access. Omitted policy preserves existing behavior.

## Remembered commands

Only a valid native command proposal and matching available decision may offer Remember. Start with recognizable GitHub read-command families; generic shell/interpreter prefixes and arbitrary GraphQL are not silently generalized. Show the entire proposed prefix and actual user-level scope before the click. Call acceptWithExecpolicyAmendment against the still-live original request; never construct rule text from callback input. Native writes current CODEX_HOME/rules/default.rules. It can affect other native clients sharing that home; do not label it Bot-only.

Track decision submission, observed rule persistence and command outcome separately. Rule readback/effective-policy checks must not execute the command. Uncertain dispatch or file acknowledgement is lookup-only and never repeats an action. Existing card/native control identity and duplicate receipts remain mandatory.

Rule inspection reports native facts and owned grant provenance. Revocation must not rewrite unrelated user configuration or lose concurrent native appends. Prefer a bridge-owned prompt overlay for owned prefixes, under the native rules directory, with strict ownership/content checks. This means require review again for future matching invocations. Loaded executors may retain prior policy: no promise of instantaneous global revocation. Re-enabling removes only the owned overlay after an explicit owner decision. Native rule files remain permission authority; audit storage cannot claim a rule is effective when files disagree.

## Auto-review and explicit retry

Use version-matched experimental item/autoApprovalReview notifications and distinguish approved, denied, timedOut and aborted. Ordinary approved reviews stay quiet. Retain exact action, source task/thread/turn/generation, review identity, time and rationale. Do not infer that every denial means the whole task failed or automatically replay after timeout.

The installed protocol provides thread/approveGuardianDeniedAction. Source inspection confirms it injects the original action's authorization marker without starting a turn; it is not a command-approval reply. A genuine owner click may create one fresh ordinary request only after the source execution is sealed/settled, protection is absent and its conversation has not advanced or acquired conflicting work. Bind the request transactionally to the recorded denial and original evidence. The native adapter resumes that same thread, injects the exact retained denied event, then starts the explicitly requested retry turn. Re-review remains native. The old task/result stays immutable; this is not an automatic repair continuation or a new verification run.

Only concrete supported denied command actions get a retry affordance initially. Timeout/abort observations do not receive a denied-action authorization. Duplicate/stale/foreign clicks, unknown source outcome, changed evidence, newer conversation work or an uncertain retry dispatch cannot create another request. Failure remains visible and protected as applicable.

## Compatibility and operational state

Keep legacy native journals readable and sealed bytes unchanged. Retain new audit/control facts in closed backups and supported archives. Runtime downgrade cannot silently undo saved user permissions. Include native rule files or an explicit external-policy dependency in the private inventory; never copy host auth as part of policy backup.

## Acceptance

Derive assertions from the requirements: explicit/resumed policy, genuine current-native proposal, correct saved prefix, no save for once/deny/timeout, immutable receipt/action binding, actual native rule parsing, duplicate/restart/storage errors, native denial authorization before a fresh turn, stale-conversation rejection, no task/report writes on queries and no loss of unrelated rules. Run full required checks once the candidate is stable; actual native protocol/model and actual Feishu owner evidence stay distinct.
