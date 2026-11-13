## Context and choice

Use the pinned Autoloop kernel through its source/worker/channel boundaries. Keep native Codex as the reasoning/tool runtime, one Feishu gateway as the human interface, and SQLite for this single-host integration. No additional model coordinator or scheduler is required.

P0's standalone runner is a starting point, not the production gateway. Its per-run replay guard, synthetic actors, control socket and fixed receipts do not supply project-wide admission, reliable real chat delivery or migration.

## Pilot boundary

One host, one bot consumer, one operator chat and one canonical registered project. A designated approval chat may be separate. Natural task text uses the configured pilot target. A registered alias selector must resolve to that same canonical project. Project-selection commands for unknown or out-of-pilot identifiers require clarification or rejection before scheduling. A shared bot's audience and rollout window belong in the activation manifest.

Native account, tools, sandbox and approval configuration remain native. Autoloop access metadata grants no additional native permission. Validate the assignment against the registered project and approved policy before `turn/start`; conflicting requirements fail visibly. Publication and business-data authority still come from the original task and project rules.

## Responsibilities and process topology

```mermaid
flowchart TB
    F[Feishu] <--> G[One gateway: verified ingress and transport]
    G -->|Stable opaque request event| H[Autoloop Hub: scheduling]
    H <--> W[Autoloop Worker: supervision and receipts]
    W --> R[Bridge-owned runner]
    G <-->|Assignment lookup and correlated live controls| R
    R <--> C[Native Codex app-server]
    R --> E[Execution State: native lifecycle and pending requests]
    G --> A[Gateway store: admission, sessions and delivery]
```

The runner/app-server stay inside the Worker's owned process group. The gateway does not own a second queue that chooses the next business task. Its inbox and source outbox deliver accepted requests to the Hub. The runner accepts exactly one bound execution at a time; Bridge's current multi-task ingress/drain is not exposed as another dispatch authority. Reuse the supported native interaction and formatting code through explicit execution/transport ports; do not ship a new gateway that also calls the legacy global `kick()` path.

Preserve P0's separate durable execution record so a gateway outage cannot erase native completion. Each execution directory is keyed by the gateway-issued execution ID, not an Autoloop attempt or merely a Hub run number. This survives different attempts/rounds for the same original request. The gateway database owns the project guard and request-to-execution pointer; the execution State owns the native outcome and request dispatch audit. Processes never call legacy `State.recover()` over another live runner's database.

## Identity and durable acceptance

| Record / fact | Authority and use |
| --- | --- |
| Verified message identity | Feishu normalization/admission: bot installation, tenant, sender, chat and immutable message ID; quoting/mention text does not supply identity |
| Request ID | Gateway-generated opaque ID, unique for the verified source message; stable across source POST retries |
| Conversation ID | Gateway owner/chat/project/session mapping captured at acceptance; native thread resolved at dispatch, after earlier work has settled |
| Project ID | Registry entry for the canonical real directory; aliases and symlinks cannot produce separate resource identities |
| Execution ID | Persisted before native effects; bound to request, conversation, project and policy; reused when the same request appears in another scheduler attempt/round |
| Hub instance, source event and run IDs | Scheduling correlation; cannot grant execution authority or replace an existing execution identity |
| Native thread/turn and process generation | Execution State / native app-server; required for controls and live responses |
| Reply UUID and destination | Gateway transport outbox; retries preserve identity and never rerun work |

Persist source deduplication, immutable request payload, admission outcome and source submission intent in one local transaction before acknowledging acceptance. Received reactions mean receipt, not native completion. Unauthorized traffic remains silent as today. A malformed or out-of-scope request receives the existing bounded help/clarification behavior without becoming a kernel event.

Publish only opaque request ID, registered event type and bounded non-sensitive summary to Autoloop. The authoritative prompt, actor and project lookup stay in gateway-owned records; copied text in job context cannot change them. The adapter verifies installation, source, rule, agent, project/cwd and exact request count against that registry. Unknown timers, manual runs, replay events or card answers do not authorize an original task.

A source POST timeout is uncertain delivery, not a new request. Retry the identical event ID/payload, then inspect the source event outcome through the pinned public API. Confirm an actual expected route: an unrouted or paused/skipped event is not successfully scheduled work. Preserve the request and expose the blockage; do not mint another ID to bypass deduplication. Native effects require both a valid assignment and admission by the execution boundary.

## Routing without coalescing or shared sessions

The inspected kernel coalesces queued events in the same rule/lane. With `resume: true`, it can inherit a completed session within that scheduling lane. Neither behavior is an acceptable substitute for chat ownership.

For P1:

- Use the immutable request ID as event subject and enable subject lanes with `parallel: 1`. In the pinned kernel, a positive value selects subject lanes; the value one also limits that group to one claimed run. Distinct lanes therefore do not require concurrent project execution.
- Use one canonical-project group shared by every alias/rule for that real directory, with consistent `parallel: 1`. A single native-agent definition can serve different project groups; no per-project agent fleet or duplicate concurrency limit is needed. Worker capacity is also one for the pilot. Configuration validation must reject aliases that split the same real directory across groups.
- Set `resume: false`. The runner ignores scheduler session suggestions as execution authority and resolves the native conversation from the verified conversation ID. The reported native session remains useful as a status projection.
- Require exactly one recognized request event per initial assignment. A duplicate publication uses the same event ID. Unexpected mixed events fail closed; never merge prompts or pick one silently.

This separates the scheduling lane (one request), native conversation (owner/chat/project/session) and resource (canonical project). The feasibility command tests kernel behavior; it does not implement gateway validation or native session lookup. Keep the selected values/shape in [the routing fixture](../../../experiments/autoloop/verify-handoff-routing.mjs) and verify them before upgrading [the shared pin](../../../experiments/autoloop/source.json).

## Admission, outcomes and uncertainty

Before any native start/resume with tool-capable work, atomically bind the execution and acquire the canonical project guard. A duplicate assignment returns the retained outcome or attaches to the proven live owner; it never calls `turn/start` again. Missing/unreachable owner, lost start response, incomplete journal or ambiguous cancellation retains the guard as uncertain. A Worker lease expiry, Hub `done`/`cancelled`, gateway reboot or elapsed timeout cannot release it.

While an execution is active, subsequent normal requests retain independent queued admission. An uncertain execution blocks new requests for that canonical project. Already published requests recheck the guard at execution admission and retain a blocked outcome. Hub pause state can record new events as skipped, so the project guard supplies the durable execution boundary. Business-card answers retain their original authority scope.

Reconciliation records who inspected what evidence and the resulting decision. Confirm native/process settlement and actual project/external effects, then distinguish: retained completion; known not-started work; explicitly authorized remaining work; or unresolved uncertainty. A controlled continuation gets its own identity and authority for remaining steps. It is not a replay of the original operation. Without evidence, keep the guard held.

Persist native terminal outcome/final answer before producing the normalized scheduler receipt. Retain native round status, business acceptance and reply delivery as separate fields. Raw model output cannot schedule events by accidental receipt syntax. P1 retains a deterministic receipt adapter and uses the gateway's original-owner reply; model-authored follow-up events and evidence-based objective completion are P3/P4 contracts.

## Live controls and human responses

Resolve status, steering and stop from the verified owner/chat and immutable quoted-task association or unique owned active execution. Admin approval authority alone does not confer ownership to steer or stop another task. Keep project/session switching from retargeting an in-flight control.

Persist each accepted control under its Feishu message identity before relaying through private authenticated IPC. Bind the relay to execution ID and current native generation/thread/turn, plus pending request ID for native responses. The runner revalidates these facts at the point of dispatch, including after awaits. A repeated message returns the recorded relay result. For a dispatch with an uncertain acknowledgement, inspect recorded dispatch/native state before any retry; never report a supplement as accepted merely because the IPC write succeeded.

Execution State is canonical for native dispatch, pending prompts and completion. Gateway control state is canonical for receipt/relay/delivery only; its projections cannot independently decide that a native request remains pending. Never resend an approval because its chat delivery or IPC acknowledgement was lost. Timeout/stop/generation change invalidates native responses without granting approval. Preserve designated administrator/chat checks and original-owner question checks from the existing Bridge.

Stop remains pending until native terminal/process evidence confirms settlement, or explicitly becomes unknown with the guard held. Cancel the Hub run when required to remove queued dispatch, but do not equate that scheduling status with native settlement. `/clear` affects only the requesting session's not-started work; `/new` cannot bypass outstanding work or project guards.

A gateway restart reconciles retained execution references and live runners before admitting new work. Runner IPC loss may delay control and delivery while native work continues; it is not proof of termination. The runner persists completion locally even when the gateway is unavailable. Reconcile and project native evidence into the gateway outbox idempotently when connectivity returns.

## Delivery and retained state

Preserve original trigger/reply destination, verified mention allowlists, final-answer filtering, secret redaction, ordered rich-post splitting, stable UUIDs and durable reaction cleanup. Reuse these existing contracts rather than changing chat UX as part of scheduler migration. Native prompt delivery remains distinct from business-card delivery. Delayed prompts are revalidated against the live owner; gateway restart cannot resurrect an expired approval.

The two stores intentionally hold different facts. Execution State is canonical for lifecycle evidence; the gateway contains an execution reference/projection plus transport state. Native history remains canonical for conversation content. Project-guard release and outbox creation must reference the exact retained execution version; a stale projection cannot overwrite a later result or clear uncertainty. This is not a second scheduling ledger.

## Drain-first cutover and rollback

Activation is a separate owner-authorized operation. Prepare a manifest first: bot/tenant/host identity, affected audience, project real path, approval destination, protocol-compatible old/new artifacts, state locations, service owners, pin and acceptance evidence. Do not store its private values in this repository.

1. Rehearse export/import and rollback on fixture copies. Reject invalid ownership, missing conversation/quote references and native version mismatch. Do not copy native authentication or downgrade another daily-use client for rollback.
2. Add a quiesce capability to the legacy-compatible entry point: stop admitting new business tasks while retaining controls, approvals, final delivery and reaction cleanup. The current source implements a persisted maintenance gate and authenticated local maintenance commands.
3. Drain queued/running work and delivery/cleanup. Require no live approvals, unknown effects or unresolved guards. If drainage cannot complete, postpone; P1 does not transfer active/queued write-capable work.
4. Prevent the old service's automatic restart, stop it and confirm its consumer/native child settled. Acquire its released state ownership lock before snapshot/import and retain exclusive managed ownership through new startup; startup/lock transfer must be covered by the handoff tool, not two competing launch commands. Inventory any other authorized consumers; a local lock does not prove another host is absent. Start no second SDK listener during preparation.
5. With SQLite closed, snapshot and checksum state. Import completed owner/session/native-thread mappings, immutable source deduplication and reply/task associations using a versioned exporter. Keep the snapshot immutable; verify semantic counts and relationships, not just file hashes.
6. Start the new runtime against its prepared state, initially closed to new work. Reconcile execution references/guards and verify the exact manifest, policy and protocol before connecting the sole consumer. Perform only the authorized owner-chat acceptance; then open admission for the approved scope.

Before the new runtime accepts anything, rollback can restore the verified closed snapshot and compatible old artifact after the new consumer stops. After any new request/control/delivery is accepted, restoring only the old snapshot is unsafe: it loses deduplication, outcomes, reply identities and new native conversation facts. Quiesce/drain the new runtime, export its post-cutover records, reconcile them and import them with a tested reverse converter. If that converter or settlement evidence is unavailable, remain paused with records intact; do not restart the old scheduler and replay missing work. Unknown effects block rollback admission just as they block forward admission.

No dual-write queue or shadow model execution is used. Rollback does not undo external operations and never authorizes production publication.

The consumer transition has an unavailable interval. Do not assume Feishu replays messages that arrive while disconnected. Acceptance guarantees apply to durably admitted requests, not every message sent during that interval; report the maintenance window and reconcile owner expectations before reopening.

## Delivery slices and outstanding choices

First prove the kernel configuration. Then implement durable gateway admission/project guards, the single-assignment runner boundary and correlated control/result delivery against synthetic transport. Add migration/quiesce tooling and fixture rehearsals before touching deployment. Finish pending P0 native interaction/recovery acceptance, then request activation against the concrete prepared manifest when the pilot is ready.

The pilot's actual bot/chat/project and rollout window are deployment inputs, not assumptions for source development. No current implementation is blocked on those private values. Model-based multi-project routing, business follow-up scheduling and broader concurrency remain outside this pilot; do not invent compatibility switches for them now.

## Implemented admission and execution slices

The native-execution slice uses a channel adapter to normalize incoming messages before the core admission API. The executor accepts one persisted permit, loads its original request, and resumes the gateway-owned conversation. Its private execution directory contains native State and an owner descriptor written before app-server starts. Terminal evidence is published atomically after native outcome observation and child exit. Recovery authenticates the retained owner permit, reads that evidence or probes the live owner, and holds an uncertain project when evidence is inconclusive.

The public Autoloop agent Turn supplies context, cwd and run identity through its documented fields/environment. It omits the full rule/agent job object. The runner therefore validates the configured rule/agent/group through the documented rules configuration and correlates the context against the source event's actual claimed run through public HTTP. The full-job admission API continues to validate explicit job fields. Both paths load task content from the retained request.

The [component entry](../../../src/handoff/gateway.ts), [private store](../../../src/handoff/store.ts) and [source client/outbox](../../../src/handoff/source.ts) now implement durable request identity, registered assignment validation, active-run source lookup and atomic project reservation. The shared private-database opener preserves the existing State permissions and SQLite settings.

The store serializes competing reservations with `BEGIN IMMEDIATE`, re-reads canonical request state inside that transaction and returns an execution permit once. It retains active/uncertain guard ownership through database reopening. Reported terminal evidence is permit-bound and idempotent. Operator recovery records its actor, source message and evidence while retaining the historical uncertain outcome. Fresh remaining work receives a new identity.

The source outbox persists the numeric Hub event ID once known. Unconfirmed publication retries the same opaque request ID with backoff. Assignment admission checks the actual source event's active run through the authenticated source API before reserving execution. Paused/unrouted events retain a visible blocked submission. Native owner authentication, sealed evidence and pre-dispatch recovery are implemented in the assigned-native entry. Human result projection is implemented in the interaction slice below; live cutover remains a subsequent task. The execution permit must still hold an active project guard at native startup and after asynchronous initialization; a revoked or uncertain grant cannot launch a new turn. A retained owner descriptor always selects inspection instead of a fresh start.

The private owner descriptor binds the retained permit to the immutable request and actor/project/conversation. Each terminal report references the exact native thread/turn/generation, observed child settlement and SHA-256 of the closed execution database. Missing, conflicting or changed evidence keeps the guard held. Additive migrations preserve existing request identities and move the old bot identity from core binding into a separate Feishu channel binding.

Owner IPC returns at most four message previews of 2000 characters each so large retained answers cannot defeat the bounded liveness challenge. These previews are diagnostics, not the human outbox or a durable control acknowledgement. The interaction slice now retains and reconciles dispatch results under task 3.3 and projects full native messages/results into its own retryable delivery records under task 3.4, without mutating the sealed execution database. The app-server environment excludes HANDOFF_ and AGENT_AUTOLOOP_ variables as well as existing Feishu credentials; native provider/configuration variables retain their existing behavior.


## Durable interaction and delivery slice

The gateway retains each admitted control under its immutable source message before IPC, fixes the execution/native generation/thread/turn before dispatch, and marks dispatch intent before writing to the owner. The native State keeps a separate dispatch record before calling Bridge, then records the actual RPC disposition. Lost gateway acknowledgements are reconciled by lookup; a control already marked dispatched is never automatically resent, including approvals. A missing native record after uncertain dispatch remains explicit. New human authorization uses a new message identity.

The human transport uses a dedicated State under the gateway state directory, reusing Outbox and Feedback without constructing a Bridge or running State.recover/kick over projected tasks. Original source/request identities and native rendered message UUIDs are imported transactionally. Retained import tombstones prevent a delivered native message from being recreated on later synchronization. Final messages require the authenticated closed native checkpoint. Live prompts/statuses require a current owner check immediately before transport; expiry/terminal/process loss suppresses stale prompts. Native journals are read only and never modified by delivery acknowledgements. Reaction cleanup remains independently retryable.

The programmatic pilot gateway accepts normalized Feishu messages and synthetic transport ports. Its isolated verifier exercises actual Hub/Worker dispatch with the existing scripted native child; it does not start a production listener. Quiesce/import/rollback now have the closed-state tools described below. Deployment and real owner-chat acceptance remain in the activation tasks.


Gateway control status and human notices are separate facts. A failed/uncertain dispatch records its notice in admission state and projects it idempotently into transport state, so a crash between those stores is repairable. An acknowledged native approval is recorded as sent, not as completed business execution. A stop RPC acknowledgement remains stopping until native outcome evidence settles it.

Periodic polling may encounter a fresh grant before its owner descriptor exists; it keeps the guard and waits rather than revoking that launch window. Explicit startup recovery remains strict for inherited orphaned grants. Once an owner descriptor exists, failed authentication/liveness retains uncertainty. A worker lost before descriptor publication can remain pending until explicit recovery; elapsed time never releases its guard.

Import completion stores the exact sealed checkpoint in transport state. Later synchronizations do not reopen completed journals or recreate delivered rows. Gateway-only notices, source routing blockage and a known pre-start cancellation retain truthful human feedback. Full native replies are redacted before gateway persistence; existing rich-post rendering, immutable reply links, per-chat order, retry identity and reaction reconciliation remain owned by their original components.

Source publication and human delivery can stall independently of native control. Admitted controls wake a serialized relay immediately and drain new control records even while another synchronization awaits outbound HTTP. Source delivery retains its own in-flight work and retry state. Historical uncertain controls stop live polling after their execution has been explicitly reconciled; their audit status is retained. A sealed journal with no native control record proves that message was not dispatched, while missing live-owner evidence remains uncertain.

## Closed-state migration implementation

The migration tool uses the legacy state directory as the shared ownership root. Both runtime entries acquire that root lock and validate a persistent role record before connecting the SDK. The pilot keeps its admission/execution/transport data in a distinct directory. A local authenticated maintenance endpoint changes persisted admission state and reports drainage. Existing tasks and controls continue while admission is quiesced. Graceful shutdown publishes a closure receipt after the consumer, native child and SQLite handles settle.

The private versioned plan identifies the bridge configuration, pilot scope, verified bot ID, chosen legacy conversation, pilot and bundle directories, and a worker/service closure inspection reference. Choosing a source conversation is explicit, including an explicit null for a fresh conversation. The tool validates owner and canonical project before importing its thread. Completed legacy data is copied into a private checksummed bundle and the pilot transport store. Retained source receipts prevent old messages from becoming new tasks.

The owner role record commits the prepared import while the shared root lock is held. Startup validates the committed role and data directory. Rollback first exports the closed pilot and native journals. With traffic present, it merges message receipts, native conversation pointers, terminal task facts and reply associations into a copy of the baseline. A single file replacement and owner-role commit publish the restored legacy state under the same root lock. Admission stays quiesced for the subsequent runtime start.

Worker/service shutdown evidence is a deployment input. The tool checks project guards, queues, pending approvals, transport cleanup, native checkpoints and file stability while exporting. The live service inventory and actual worker shutdown remain activation checks. Rehearsals use temporary databases and controlled processes.

Each prepared database retains its handoff operation identity. Managed startup, assignment entry and rollback validate these identities before constructors can create new state files. Missing prepared data requires recovery of the retained state. The default legacy startup also requires its restored database when a managed owner record is present.
