# Specification workflow

OpenSpec is used here for proposed changes to execution, orchestration, authorization, interactions, recovery and evidence contracts. It is a development process, not the runtime scheduler. Autoloop remains the proposed runtime orchestration choice.

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

No production orchestration baseline has been archived. The isolated P0 probe is implemented with scoped evidence, but its change remains open for pending real-model interaction/recovery acceptance. Existing production-behavior documents continue to apply; proposed production migration stays under a separate change until implemented and verified.

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

[integrate-feishu-autoloop-handoff](changes/integrate-feishu-autoloop-handoff/README.md) owns pilot admission, the scheduling/identity split, controls, project guards and drain-first migration/rollback. Durable admission/source/guards and single-assignment native execution are implemented, including authenticated owner/checkpoint recovery and actual Hub/Worker verification. Durable control relay and human outbox/reaction projections are also implemented in the isolated pilot gateway. Closed-state migration and both rollback windows are implemented with fixture evidence. Complete candidate checks and independent review passed. The owner-authorized fresh M6 deployment has basic private-chat and background-restart evidence. Full native interactive and remaining owner-chat capability acceptance remain open. Validate this change separately from P0 and retain the pending native/live acceptance tasks.

## General workspace change

[enable-general-workspace-mode](changes/enable-general-workspace-mode/proposal.md) adds explicit neutral-workspace execution, direct task targeting through native Codex and workspace status. It preserves one canonical resource and existing native authorization. Track implementation, review and the authorized M6 rollout in its tasks.
