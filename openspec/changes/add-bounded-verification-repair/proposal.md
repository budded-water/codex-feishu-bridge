# Bounded verification repair

## Why

The deployed verification flow ends after one native turn and one UI-eval invocation. An operator must read a candidate failure and submit the repair themselves. A small, explicitly authorized continuation can remove that handoff for a known failure class while retaining native Codex.

## What Changes

Propose `/verify-repair PROFILE TASK` as a new-task opt-in for the enrolled owner in the existing private-chat/approval boundary. **This command is not implemented or available.** Ordinary tasks, `/verify` and `/verification` retain their contracts.

The first slice permits one initial native turn, at most one additional repair turn in the same verified conversation, and at most two fresh verification invocations under one assignment/guard and finite admitted deadlines. Only registered deterministic Web functional failures with sound evidence qualify. Other failures return to the owner. Use an isolated fixture first; no business task is currently selected.

Retain immutable attempt evidence, explicit continuation provenance, current-attempt controls and lookup-only recovery. Repair cannot weaken the acceptance floor, create publication authority or convert an unknown outcome into a retry.

## Impact

This is a **design-only proposal**, not implementation, deployment or permission to run extra model turns. It adds no dependency, service, command handler, private configuration or migration. Implementation first needs the native continuation/control proof in [design](design.md); [tasks](tasks.md) keep those gates open.

The [P3 business acceptance](../add-project-verification-handoff/tasks.md) remains pending. [Host exercises](../../../docs/operational-readiness.md) remain independently deferred to an owner-specified idle window. Neither blocks isolated development, and this proposal cannot complete either gate.

## Non-goals

- Automatic discovery, generic retries, parallel goals or scheduler replacement.
- UI-eval agent mode, another harness or another model for coordination/formatting/review.
- Automatic independent review, merge, publication, report hosting or business acceptance.
- Replaying uncertain work or broadening native-only Feishu recovery.

## References

- [Current verification](../../../docs/project-verification.md), [system direction](../../../docs/agent-system-plan.md) and [handoff requirements](../../specs/remote-task-handoff/spec.md).
- The profile's reviewed UI-eval source pin remains authoritative. Inspect `src/integration/model.ts`, `src/integration/run.ts` and `src/evaluators/functional.ts` before implementation: aggregate `fail` alone does not prove repair eligibility.
