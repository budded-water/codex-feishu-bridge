# Isolated Autoloop execution probe

Status: implemented experimental entry point. This is not the production scheduler or a Feishu deployment. The existing application keeps its listener, queue and private configuration. The broader direction remains in [the system plan](agent-system-plan.md); requirements and task evidence are in [the P0 change](../openspec/changes/verify-codex-autoloop-execution-boundary/README.md).

## Process and state ownership

| Component | Ownership in this probe |
| --- | --- |
| Pinned Autoloop Hub | Source-event admission, event deduplication, logical run ID, continuation session and round receipt |
| Autoloop Worker | Saved attempt, detached process group, restart discovery, cancellation and result delivery retries |
| Standalone agent plugin | Launch the bridge-owned runner; report progress/session while running and a normalized receipt only after exit |
| Runner and existing Bridge | One assignment in an isolated State database, native thread/turn correlation, existing live-control and approval checks |
| Native app-server | Conversation, model reasoning, tools, local identity/configuration, sandbox and approval policy |
| Synthetic transport | Drain the fixture outbox into local responses; never start the Feishu SDK |

The runner and its direct app-server child stay inside the Worker's process group. They are not independently detached services. A Worker restart can find the existing detached execution; a Worker cancellation can settle its group. Normal runner exit awaits observed app-server exit, including the forced-kill path. This does not establish rollback of completed filesystem/network effects or settlement of independently detached external services.

Each logical run uses `bridge-probe-executions/<run>` under the isolated Autoloop home. Worker attempt directories change after retry; they are not the execution identity. The existing State database persists the task before `turn/start`, then records the returned native thread/turn. No second execution journal or replacement transcript is introduced. A lock prevents simultaneous runners for the same run on this host.

An existing assignment is read before starting app-server. Confirmed completion returns its stored outcome. An unfinished/unknown/failed outcome produces a reconciliation question, without calling `turn/start` again. A pending record after process loss is inconclusive; this probe does not reconstruct a missing turn ID or prove that external effects did not happen. Reconciliation is deliberately allowed to end in `unknown`.

Hub state and bridge State are separate authorities: the Hub owns scheduling/delivery; State owns local execution evidence. Native history owns conversation content. The run ID and native session report link them. Neither a Hub `done` round nor an accepted receipt proves business acceptance. P1 must specify how these records are reconciled when they disagree.

## Controls and receipts

The runner publishes a private Unix socket descriptor in its run-state directory. The socket itself uses a short private temporary path for macOS path-length limits. One bounded JSONL request requires the ephemeral fixture token. Control messages then pass through existing Bridge tenant/user/chat/owner/project checks. Only status, steering, stop and native response commands are admitted by the probe. Production chat identity extraction remains a separate P1 responsibility; fixture actor IDs are synthetic.

Native approvals use the existing designated administrator/chat, pending request, process generation, thread/turn and expiry checks. They do not use Autoloop business cards. A fixture control response drains synthetic deliveries in order; it is not an implementation of reliable production control transport.

The plugin always marks its wrapper as started, conservatively disabling Autoloop's fresh-session fallback. It reports a terminal receipt only after wrapper exit. A wrapper failure or ambiguous native outcome produces a valid reconciliation question, rather than `FAILED`, which the pinned scheduler could retry automatically. Raw model answers never become scheduler protocol: this probe uses fixed normalized receipts. It therefore demonstrates execution boundaries, not model-authored follow-up scheduling, UI-eval or release decisions.

Autoloop's `access: read` is scheduler metadata here. The custom plugin preserves native policy; that metadata does not independently impose a read-only sandbox. The bounded real-model test requests no tools and checks stored history afterward. P1 must explicitly define policy validation for every admitted assignment.

## Reproduce

Requires Node 24, a built bridge, a compatible native Codex for native mode, and a separate clean Git checkout of the repository and commit in [source.json](../experiments/autoloop/source.json). Clone that repository and check out its recorded commit; no global installation is required. The verifier checks origin, exact HEAD and cleanliness, including untracked files. Updating this pin requires a new upstream review and rerunning acceptance; do not automatically track upstream HEAD.

```bash
npm ci
npm run check
npm run smoke:codex
npm run verify:autoloop -- /absolute/path/to/pinned-autoloop
```

The default integration verification starts the actual pinned Hub and Worker with loopback HTTP, a fault-injecting acknowledgement proxy, temporary state and a scripted Codex RPC process. It requires no model access. Cleanup stops fixture-owned processes and removes temporary state. It does not load a channel adapter, production bot configuration or production jobs.

Explicit real-model acceptance:

```bash
npm run verify:autoloop -- /absolute/path/to/pinned-autoloop --native
```

This uses the host's native Codex identity/configuration for two fixed-text rounds in one new conversation, with a 120-second Worker limit per round. It checks completed native IDs, exact replies, same-thread continuation and stored native history. It creates ordinary native conversation history and consumes native service usage. It does not modify authentication/configuration or send Feishu messages. Do not interpret it as a test of write-capable business work, real native approvals, steering during model execution, or recovery of external side effects.

## Evidence and readiness

Observed acceptance is recorded in [live acceptance](live-acceptance.md), separately from deployed bot evidence. The default automated suite covers adapter ownership, pending-request validity, expiry, cancellation, uncertainty and receipt guarding; the explicit integration verifier adds real Hub/Worker supervision and fault injection.

Initial probe decision: the documented Autoloop plugin boundary is viable for this single-host execution probe. Continue to a separate P1 handoff design; retain the existing production scheduler until that design and its acceptance pass. This result does not establish production migration readiness.

The [P1 handoff](../openspec/changes/integrate-feishu-autoloop-handoff/README.md) subsequently implemented and activated the authorized M6 owner-private pilot. Its dated real-model steering, stop, command approval/refusal and inspected app-server-loss recovery complete P0's bounded native campaign. P0's isolated command itself still uses synthetic transport; the initial decision above records its original handoff boundary.

The P1 handoff requirements below are implemented and accepted within the recorded owner-private scope. The project-evidence contract remains planned for P3:

- One Feishu consumer, verified identity-to-assignment mapping, and durable control/answer delivery with correlation and duplicate handling.
- One production scheduling authority: drain/transfer existing queued and in-flight tasks, backup state and define rollback.
- Lane/project admission barriers after an uncertain outcome, including new events and business-card answers. The probe's same-run replay guard alone is insufficient.
- Policy ownership and supported native interaction families under the actual deployment policy; business-round decisions must remain distinct from native approvals.
- Durable result/artifact schemas and evidence acceptance for project checks, UI-eval and release-kit, with explicit publication authority.
- Real-model steering, approval/rejection and process-loss acceptance in a dedicated pilot project. Fault-injected protocol acceptance is not a substitute.
- Review the pinned kernel and plugin contract before each upgrade. The isolated prototype shares Bridge code; P1 owns the deployed single-assignment path and scheduling consolidation.

No parallel Hatchet implementation, custom dashboard, additional harness or automatic issue discovery is introduced by P0.
