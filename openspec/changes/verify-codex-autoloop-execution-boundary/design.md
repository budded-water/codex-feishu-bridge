## Context

The live architecture remains the current Feishu bridge. It has a native app-server adapter, owner-scoped conversation mappings, directory serialization, interactive requests and independent answer delivery. Its simulated coverage and observed live coverage are separate facts.

Autoloop's built-in Codex adapter uses exec/resume and unattended approval behavior. The proposed system needs a bridge-owned app-server executor for native interaction and continuation. The difficult boundary is the lifecycle of real work, not translating one JSON payload.

## Goals / Non-Goals

Goals:
- Establish a selected CLI/binding compatibility baseline without changing native account identity or relaxing policy.
- Demonstrate one logical assignment, a correlated native conversation, controls and a terminal receipt.
- Determine whether documented plugin boundaries can support settlement and recovery.
- Make readiness auditable without exposing private deployment state.

Non-goals:
- Production queue migration, bot/channel activation or a second Feishu consumer.
- UI-eval, publication, worktree automation, multi-host execution or proactive work.
- Installing another harness or introducing a permanent model-backed coordinator.

## Decisions

### Preserve native identity and version authority

Use the configured native executable and generated bindings from the same selected release. Prefer compatibility with the host's intended release over downgrading an unrelated daily-use client. Inspect schema differences and behavior tests before changing the pin. The generated release constant remains the single compatibility literal; deployment observations are dated evidence, not permanent configuration defaults.

### Isolate the integration probe

Use temporary fixture state, a reviewed Autoloop revision and synthetic transport inputs. The production bridge keeps its queue and listeners until a later change explicitly migrates them. The probe owns only its fixture assignments and processes; it must not consume production jobs or alter host authentication.

### Correlate actual work, not submission acknowledgements

Persist an execution identity before a request can have effects. Map it to the Autoloop assignment and returned native thread/turn identifiers. Observe the authoritative native outcome before producing a terminal success receipt. If start or completion acknowledgement is lost, retain enough identity and evidence for reconciliation and classify unresolvable cases as uncertain.

Thread history belongs to Codex. Adapter records contain lifecycle/correlation facts; they are not a replacement transcript or a second scheduler.

### Separate business replies from live native requests

Task follow-ups and business questions may become subsequent rounds. Native approval and question responses target an active request and must be checked against its owner, designated actor, process generation, thread, turn and pending status. Preserve the existing policy and supported interaction subset. Timeout, cancellation and restart never imply approval.

### Settle cancellation and recovery

The probe must identify who owns app-server and its spawned work, how control reaches a live execution, and how the owner confirms settlement. Cancellation acceptance is not a terminal outcome. A dead worker or expired lease is insufficient evidence that external work did not run.

The implementation must select and document the process/control topology before expanding the probe. Test normal completion, interruption, worker/process loss and lost receipts. Any topology that reports success while detached work continues, or retries unknown write-capable work blindly, fails readiness.

### Report only demonstrated readiness

Keep fixture tests, real no-inference handshake, authorized inference, live interaction and process recovery results separate. No-inference smoke is not model acceptance. Update current architecture/status documents only for actual delivered changes and retain outstanding live acceptance items.

## Risks / Tradeoffs

- App-server is evolving: release alignment and lifecycle regression evidence are required.
- A wrapper can exit before its actual work: the probe must follow work through settlement.
- A response can be lost after acceptance: stable identity and lookup must precede another attempt.
- Lifecycle controls may not fit an adapter boundary: record the exact gap before proposing a kernel change.
- Real requests can have side effects: use bounded fixtures and only authorized live tests.

## Migration Plan

This change does not migrate production state. Retain the existing listener, mappings, queue and outbox. A later handoff proposal must describe draining/in-flight work, state mapping, the single-consumer cutover, backup and rollback. Fixture state can be discarded only after its owned work is settled and its sanitized result is recorded.

## Open Questions To Resolve In P0

- Which process/control topology preserves native requests while fitting Autoloop worker supervision?
- Which installed protocol changes affect existing supported interactions?
- What can be conclusively reconciled after each lost-acknowledgement window, and what must remain unknown?

Resolving these questions is part of the technical probe; this design does not claim an already-working transport or recovery protocol.
