# Bounded verification repair

## Why

The deployed verification flow ends after one native turn and one UI-eval invocation. An operator must read a candidate failure and submit the repair themselves. A small, explicitly authorized continuation can remove that handoff for a known failure class while retaining native Codex.

## What Changes

Implement `/verify-repair PROFILE TASK` as a new-task opt-in for the enrolled owner in the existing private-chat/approval boundary. It requires a registered repair policy. Ordinary tasks, `/verify` and `/verification` retain their contracts. Managed activation and actual Feishu acceptance are separate gates.

The first slice permits one initial native turn, at most one additional repair turn in the same verified conversation, and at most two fresh verification invocations under one assignment/guard and finite admitted deadlines. Only registered deterministic Web functional failures with sound evidence qualify. Other failures return to the owner. Use an isolated fixture first; no business task is currently selected.

Retain immutable attempt evidence, explicit continuation provenance, current-attempt controls and lookup-only recovery. Repair cannot weaken the acceptance floor, create publication authority or convert an unknown outcome into a retry.

## Impact

The implementation adds compatible goal/attempt records, explicit internal continuation, narrow engine-validated eligibility, goal stop/receipts and version-2 manifest-bound results. It adds no dependency, service or model manager. Isolated continuation/control tests and an actual scheduler/browser campaign have evidence; complete review, real inference, managed activation and actual owner acceptance are separately tracked in [tasks](tasks.md). See [runtime contract](../../../docs/bounded-repair.md).

The [P3 business acceptance](../add-project-verification-handoff/tasks.md) remains pending. [Host exercises](../../../docs/operational-readiness.md) remain independently deferred to an owner-specified idle window. Neither blocks isolated development, and this proposal cannot complete either gate.

## Non-goals

- Automatic discovery, generic retries, parallel goals or scheduler replacement.
- UI-eval agent mode, another harness or another model for coordination/formatting/review.
- Automatic independent review, merge, publication, report hosting or business acceptance.
- Replaying uncertain work or broadening native-only Feishu recovery.

## References

- [Current verification](../../../docs/project-verification.md), [system direction](../../../docs/agent-system-plan.md) and [handoff requirements](../../specs/remote-task-handoff/spec.md).
- The profile's reviewed UI-eval source pin remains authoritative. Inspect `src/integration/model.ts`, `src/integration/run.ts` and `src/evaluators/functional.ts` before implementation: aggregate `fail` alone does not prove repair eligibility.
