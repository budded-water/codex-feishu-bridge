# Specification workflow

OpenSpec is used here for proposed changes to execution, orchestration, authorization, interactions, recovery and evidence contracts. It is a development process, not the runtime scheduler. Pinned Autoloop is the runtime orchestration choice for the authorized M6 pilot.

## Where facts belong

| Location | Meaning |
| --- | --- |
| [Agent system plan](../docs/agent-system-plan.md) | Recommended direction, tradeoffs and milestone boundaries |
| changes/<change>/proposal.md | Why a specific change is proposed and its scope |
| changes/<change>/design.md | Implementation decisions, ownership and unresolved technical questions |
| changes/<change>/specs/<capability>/spec.md | Proposed behavioral requirements with testable scenarios |
| changes/<change>/tasks.md | Implementation and verification checklist |
| specs/<capability>/spec.md | Delivered normative behavior after an implemented change is synced |
| [Current architecture](../docs/architecture.md) and [implementation status](../docs/implementation-plan.md) | What the repository currently implements |
| [Live acceptance](../docs/live-acceptance.md) | What was actually observed in a deployment |

No orchestration baseline has been archived. P0 and P1 have completed bounded implementation/acceptance, including the authorized M6 owner-private deployment and inspected app-server-loss recovery. The implementation is merged through PR #12; delivered baseline/spec synchronization remains separate; current deployment evidence and unexecuted live families remain in the dated record. A checked pilot task does not imply universal deployment acceptance.

## Working method

1. Read the repository instructions, current architecture and relevant acceptance records.
2. Create or refine one bounded change. Write the proposal, delta specs, design and tasks before implementing its behavioral changes.
3. Review ownership, authorization, ambiguous effects, acceptance scenarios and explicit exclusions. Follow the user's task authorization and the repository's existing PR/merge rules.
4. Implement through coherent PRs. Update artifacts when decisions change; small wording edits or fixes preserving the established contract do not need a new change directory.
5. Run strict format validation and the repository's required checks. For protocol changes, use the version-matched local Codex and the separate no-inference smoke. Obtain live evidence only within authorized test scope.
6. Record actual outcomes and remaining gaps. A checked task needs corresponding artifacts and evidence; formatting success does not prove behavior.
7. Sync/archive a delivered change after applicable verification. Never archive to make unfinished work disappear, or sync proposed capabilities as current behavior.

The CLI can be installed separately or run from an isolated tool location. This setup used OpenSpec 2.0.0 with schema spec-driven and tools=none. No assistant skills, global configuration, runtime dependency or application behavior was installed by the repository setup. Tool-specific commands are optional; the Markdown artifacts and CLI are sufficient for this change.

With a compatible CLI available:

~~~sh
openspec list --json
openspec status --change verify-codex-autoloop-execution-boundary --json
openspec validate verify-codex-autoloop-execution-boundary --strict --no-interactive
~~~

Future CLI upgrades must inspect supported commands and generated-file changes instead of overwriting repository instructions.

## Initial change

[verify-codex-autoloop-execution-boundary](changes/verify-codex-autoloop-execution-boundary/proposal.md) covers P0 only: protocol readiness and an isolated native-execution integration probe. Production queue handoff, bot activation, UI acceptance, publication and proactive execution are outside that change. Later milestones receive their own changes when their scope is concrete.

## P1 handoff change

[integrate-feishu-autoloop-handoff](changes/integrate-feishu-autoloop-handoff/README.md) owns pilot admission, the scheduling/identity split, controls, project guards and drain-first migration/rollback. Durable admission/source/guards and single-assignment native execution are implemented, including authenticated owner/checkpoint recovery and actual Hub/Worker verification. Durable control relay and human outbox/reaction projections are also implemented in the isolated pilot gateway. Closed-state migration and both rollback windows are implemented with fixture evidence. Complete candidate checks and independent review passed. The owner-authorized fresh M6 deployment completed bounded private-chat assignment, steering, stop, command approval/refusal, app-server loss and inspected recovery with fresh continuation. Validate this change separately from P0 and retain the dated limits, including local-operator recovery and unexecuted colleague/group interaction families.

## General workspace change

[enable-general-workspace-mode](changes/enable-general-workspace-mode/proposal.md) adds explicit neutral-workspace execution, direct task targeting through native Codex and workspace status. It preserves one canonical resource and existing native authorization. Implementation and independent review passed. The authorized M6 workspace deployment is running, with owner-confirmed workspace status and no-fixed-project reply. Read-only evidence verified continuation in the original native conversation and drained execution/delivery state; its bounded tasks are complete. The bounded native interaction/recovery campaign is recorded under P0/P1; broader live interaction families remain separately scoped.

## P2 inspected recovery change

[enable-feishu-inspected-recovery](changes/enable-feishu-inspected-recovery/proposal.md) adds a bounded owner-private maintenance path through Feishu, reusing sealed native evidence, the recovery ledger and durable transport. It is a separate slice above P1; its [tasks](changes/enable-feishu-inspected-recovery/tasks.md) distinguish implementation, review and actual live rollout. A human still owns descendant-process and external-effect inspection.


The P2 inspected-recovery change has completed its bounded implementation, source review, deployment and real M6 owner-private acceptance. Gateway restart retained the single recovery decision and notice, and a fresh no-tool turn continued the original native conversation. Its implementation is merged; spec synchronization remains pending. Human effects inspection, separate Hub maintenance and broader operation remain outside the completed slice.

## Read-only incident diagnostics change

[add-readonly-incident-diagnostics](changes/add-readonly-incident-diagnostics/proposal.md) adds bounded process observations and an owner-private report through `/recover`, without new recovery authority or model inference. Its [tasks](changes/add-readonly-incident-diagnostics/tasks.md) separate implementation, source review and live deployment acceptance. Compatible archival retains the optional metadata; absent or incomplete facts remain explicit.


The read-only diagnostic slice has completed source review, deployment and bounded real owner-private acceptance. A registered running wait appeared in the actual report while logical admission, native evidence and Hub run stayed unchanged across viewing. Separate operator inspection/cleanup, an actual owner recovery confirmation and fresh same-thread continuation completed the test. Its implementation is merged through PR #12; complete descendant/effect proof and automatic cleanup are outside this slice.


## Owner-private queue withdrawal change

[enable-owner-queue-withdrawal](changes/enable-owner-queue-withdrawal/proposal.md) adds a bounded queue view and exact unstarted-request withdrawal. It preserves launch-race arbitration, deciding actor/message, prior block reasons, durable notice delivery and rollback deduplication. Its [tasks](changes/enable-owner-queue-withdrawal/tasks.md) track candidate verification and live acceptance separately. Sampled process diagnostics remain outside process-termination authority.


## English chat command contract

[standardize-english-chat-commands](changes/standardize-english-chat-commands/proposal.md) supersedes the slash spellings in earlier changes. Current examples use English; dated acceptance retains the syntax actually observed. It includes gateway-local help, retired-token rejection and coordinated drained activation. Existing owner/approval policy, stored message identity and the outstanding queue live-acceptance gap remain unchanged.

## Approval cards

[enable-feishu-approval-cards](changes/enable-feishu-approval-cards/proposal.md) covers authenticated same-private-chat buttons, exact native target binding and durable card updates. Manual English commands remain available. Its tasks distinguish code verification, review and actual app/owner acceptance; older approval-command evidence remains historical.

## Consolidated delivery and proposed P3

The cumulative harness implementation is merged through [PR #12](https://github.com/budded-water/codex-feishu-bridge/pull/12); dated earlier open-PR records remain historical. Runtime approval-card support is deployed with managed readiness. The owner-authorized application callback version is published. Real owner button acceptance remains pending, so unfinished change tasks are retained.

[add-project-verification-handoff](changes/add-project-verification-handoff/proposal.md) is the next proposed slice. It selects a trusted project adapter and pinned UI-eval CLI, preserves separate native/verification/review/release outcomes and defines implementation/real acceptance tasks. It does not add runtime verification or authorize release.
