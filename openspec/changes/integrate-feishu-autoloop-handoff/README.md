# P1: Feishu and Autoloop handoff

Status: durable admission, source delivery and project-guard components are implemented and exercised through the pinned Hub. Native runner/control wiring, startup process reconciliation and migration/activation remain open. P0 real-model interaction/recovery acceptance remains in the task list.

Read [proposal](proposal.md), [design](design.md), [requirements](specs/remote-task-handoff/spec.md) and [tasks](tasks.md). The design owns P1's proposed handoff contract; [current architecture](../../../docs/architecture.md) continues to describe the delivered runtime. Do not archive this change or mark runtime tasks complete based on the routing check alone.

## Admission component

[PilotAdmission](../../../src/handoff/gateway.ts) normalizes flattened SDK callback events with the existing normalizeMessage function. Its programmatic PilotScope binds installation, operator/chat, canonical project and Hub source/rule/agent. [AdmissionStore](../../../src/handoff/store.ts) atomically retains original messages, request/conversation/execution IDs and source intent in a private SQLite database. [SourceOutbox](../../../src/handoff/source.ts) publishes stable opaque events and verifies the source event's claimed Hub run before reserving execution.

Run `npm run verify:handoff-routing -- <pinned-checkout>` for the executable component path. It covers actual Hub delivery, lost acknowledgement, reopening, project blocking and recovery with synthetic execution reports. Run `npm run check` for database concurrency, ownership, immutable identity and existing behavior regressions.

Active work permits subsequent queue admission. An uncertain execution holds the canonical project across aliases and reopening. The execution owner can report verified terminal evidence with its retained permit. The operator can alternatively record an explicit recovery decision with a scoped event and evidence reference, then authorize a fresh request. Repeated decisions and terminal reports preserve newer guards.

Execution reports and operator evidence declarations currently enter through the component API. Task 3 connects them to authenticated native owners, actual lifecycle evidence and live controls. Task 2.3 retains the startup process-reconciliation work. The current executable verification supplies synthetic reports.
