# Bounded verification repair

The P1 entry implements an explicit owner-private repair task. One M6 deployment has completed bounded real owner fixture task, command-approval button, final delivery and read-only history acceptance; see [live acceptance](live-acceptance.md) for exact scope and remaining families. New deployments require their own acceptance. Existing ordinary tasks and `/verify` retain their behavior.

## Use and trusted policy

```text
/verify-repair example Implement the requested change in this profile's project
/status
/stop
/verification COMPLETE_EXECUTION_ID
```

This starts a new task, retaining its real owner/chat/message and declared project. It allows at most two native Codex turns and two full UI-eval invocations under one existing Autoloop assignment/resource guard. The second turn resumes the same verified native conversation and uses the existing local subscription, tools and native approvals. An already passing first turn uses no repair credit. History, duplicate input and delivery retry never authorize another invocation.

Register the ordinary trusted [verification profile](project-verification.md), then optionally add this field to that profile in private `HANDOFF_CONFIG`:

```json
{
  "repair": {
    "scenarios": ["home"],
    "timeoutMs": 180000
  }
}
```

There is no repair default; an operator must select the work budget and eligible scenario IDs. Admission snapshots the definition and absolute deadline. The actual pinned Worker's agent must have an explicit timeout covering the remaining work budget plus the harness cleanup allowance. The assignment runner checks its actual Worker `entry.json` launch/job identity and deadline, rather than trusting a chat-supplied value or a copied configuration estimate. Insufficient/unavailable budget produces an incomplete handoff without native dispatch. The existing plugin requires no kernel modification. Both ordinary bridge example configurations remain unchanged: these are private P1 profile fields, not bridge.config.json defaults.

Verification commands still run as the host account outside the native command sandbox. The registered policy/engine/script trust boundary and environment exclusions remain those of ordinary verification. Pin all mandatory acceptance files and their trusted script inputs; native work cannot weaken that floor and obtain acceptance. A profile update changes its digest and can make historical observations stale.

## Eligible failure class

The first slice is deliberately narrow: fresh Web reports with a directly observed failed product functional assertion, completed capture/cleanup, registered scenario and passed required non-scenario stages. Native work must complete, all trusted pins must match, and no stop/deadline may prohibit dispatch.

The selected engine validates integration/report/capture/policy data. The harness checks the canonical report/source/policy bindings and allows failed gates only in these simple policy shapes: `interaction.failedAssertions eq 0`, `interaction.failedAssertions lte 0`, or `execution.valid eq true`. All capture steps must pass, assertion origins must be product, and only `interaction.assertion-failed` findings may remain. Other gates, failed steps, unknown scores, visual judgments, external-service/fixture/driver/runner faults and mixed results return to the owner. This is a narrower dispatch policy, not a second UI-eval evaluator. Register checkpoint assertions for the first fixture; an action-step failure is not eligible.

Build/check failures, missing human review, absent environments, unsupported evidence and rate limits do not start a repair. A known ineligible result settles truthfully. Missing/invalid results after possible launch or uncertain cleanup retain an unknown guard and require inspection.

The harness additionally seals tracked Git diff/HEAD and bounded nonignored untracked file bytes before/after verification, and rechecks source and registered policy before continuation. Inspection is bounded; unsupported/oversized source prevents automatic repair without inventing acceptance. Engine SourceRevision remains authoritative for its report. The canonical guard serializes harness work, not external host writers or all same-account filesystem access.

## Attempts, controls and evidence

The additive `repair_goals` and `repair_attempts` records are distinct from existing `verifications` rows. Native/verifier launch intent and credits commit before possible dispatch. The original trigger is used for replies; an internal continuation port records goal/attempt/prior checkpoint instead of inventing platform ingress. Each attempt has its own journal, native generation/turn, checkpoint and process sidecar under its execution directory. The final version-2 native report binds an ordered immutable goal manifest. Existing version-1 journals/results retain their interpretation; unsupported older readers fail closed.

Actual current native approvals/questions/steering retain their permissions. A prior attempt's approval or snapshot cannot control the next one. During verification/transition gaps, status and goal stop are supported; other controls are rejected. Goal stop and its original control receipt commit atomically in admission state, and its transport notice is independently projected with stable identity. Once accepted, stop prohibits later work even if a failure qualifies for repair. Wall-clock approval waiting consumes the work budget.

Only the final relevant native answer and goal/verification handoff are delivered. Earlier native answers remain in their sealed attempt journals. Terminal prior prompts are projected so stale controls cannot remain actionable. Native completion, declared verification, independent review, business acceptance, delivery and publication authorization stay separate. No extra model formats results or manages the loop.

Lifecycle timestamps retain per-attempt start, native settlement, verifier start and observation; these measure harness elapsed time, not model compute or exact token charges. Attempts/time are bounded, but a turn is not a fixed token amount. No new token-cost measurement or performance improvement is claimed.

## Restart, upgrade and rollback

A live authenticated owner survives gateway reconnection. Owner/Worker loss performs lookup-only reconciliation; it never starts an unused attempt or verifier credit. Unknown guards remain until supported local inspection of every attempt, descendants and effects. Existing native-only Feishu `/recover` cannot release repair-goal uncertainty. A fresh owner task is required after recovery; original uncertain outcomes are retained.

Drain tasks, prompts, controls and delivery before coordinated gateway/Worker replacement. Never enable a mixed-version pair. The updated rollback converter requires settled selections or existing inspected unknown recovery, verifies projected final handoffs and archives admitted attempt directories/manifests without changing their bytes. Retain project JSON/HTML and assets separately, as described in the [backup runbook](operational-readiness.md). Never restore an older database over later accepted receipts. The old single-observation converter does not support the new evidence layout.

## Isolated verification

After required checks/build:

```sh
node scripts/verify-bounded-repair.mjs \
  --engine /absolute/path/to/reviewed-ui-eval --revision FULL_REVIEWED_COMMIT \
  --autoloop /absolute/path/to/pinned-autoloop \
  --output /absolute/path/to/new/private-evidence --browser-channel chrome
```

The command refuses an existing output directory. It first submits a repair whose work window fits the Worker timeout but whose cleanup allowance would run past it. The Hub must settle that request with zero attempts. It then runs the broken Web fixture and retains both report pairs and native attempt evidence. It runs actual pinned Hub/Worker, owner IPC, UI-eval and Chrome. Native protocol is scripted by default; `--native --codex /absolute/path/to/codex` consumes real subscription usage and uses the host's native permissions without fabricated approvals. An unexpected approval or unavailable environment is a separate acceptance issue, not permission to bypass it. Human transport is synthetic: this command does not connect Feishu, accept a business feature or authorize publication. The first native turn intentionally leaves the isolated defect for verification; only the continuation repairs it. Run both paths against the exact [Autoloop pin](../experiments/autoloop/source.json) before switching Hub/Worker versions. This exercises the Worker deadline fields used by the assignment runner.
