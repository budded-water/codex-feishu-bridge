## 1. Contract and upstream feasibility

- [x] 1.1 Inspect live repository/P0 evidence and the pinned kernel's routing, coalescing, session and concurrency behavior.
- [x] 1.2 Record the concrete pilot scope, authority records, control semantics, uncertainty barrier, migration and rollback contract.
- [x] 1.3 Verify distinct request lanes, duplicate publication, same-project alias serialization, independent projects and disabled session inheritance against the real pinned Hub without model/Feishu access.
- [x] 1.4 Run strict OpenSpec validation, repository checks and update navigation/status with the actual feasibility result.

## 2. Durable gateway admission

- [x] 2.1 Implement verified immutable request/conversation/project identity and atomic deduplication plus source outbox; validate one request per assignment and all bound registry fields.
- [x] 2.2 Implement idempotent source delivery and route-outcome reconciliation, including accepted-but-unacknowledged and paused/skipped events.
- [x] 2.3 Implement canonical-project guards, boot reconciliation and evidence-backed explicit recovery; cover new/queued requests, aliases, process loss and card-answer bypass attempts.
- [x] 2.4 Add meaningful persistence/concurrency tests using actual database transitions and preserve existing transport/owner contracts.

For 2.3, recovery now authenticates live owner endpoints or validates sealed native checkpoints before new dispatch. Missing owners, lost start acknowledgement and native process loss retain uncertain guards; revoked/uncertain permits cannot launch new work. The routing command uses synthetic reports, while verify:assigned-native exercises real Worker/plugin processes and native journals. The isolated gateway now initializes with strict recovery and projects human output under 3.4; deployed exclusive ownership and activation remain in section 4.

## 3. Assigned native execution and controls

- [x] 3.1 Introduce the single-assignment execution port without exposing the legacy global queue as a second scheduler; resolve native threads from verified conversation records.
- [x] 3.2 Implement execution-ID deduplication across Hub runs/attempts and retained completion/unknown lookup before any native effects.
- [x] 3.3 Implement durable correlated control relay with point-of-dispatch actor/pending/generation checks, uncertain acknowledgement handling and no automatic approval replay.
- [x] 3.4 Project final results/reactions/native prompts into the existing transport outbox idempotently; exercise gateway outage, Worker loss, delivery retries and stop/completion races.
- [x] 3.5 Complete P0's pending bounded native steering, approval/rejection and process-loss acceptance in the dedicated pilot scope.

For 3.1–3.2, verify:assigned-native connects the public plugin Turn/context, actual claimed source run, retained request and native conversation. It verifies Worker restart, checkpoint reuse, native continuation, approval ownership, observed stop and uncertain process outcomes. The --native mode verifies two fixed-text turns in one native conversation with no tool execution items. Tasks 3.3–3.4 now have durable gateway/native control records and full native prompt/result projections through existing Outbox/Feedback. Tests cover uncertain/lost acknowledgements without replay, actor/generation/quote targeting, gateway outage, delayed stale prompts, stable-ID result retries, separate reaction cleanup, source-route blockage and stop/completion races. The actual Hub/Worker verifier also uses this programmatic gateway with synthetic human transport. Migration tools and their fixture rehearsals are complete under 4.1–4.2. Live listener acceptance remains in section 4. The deployed owner-chat repository analysis now supplies real-model active-steering evidence under 3.5. The deployed stop case reached an interrupted native turn and drained execution/delivery state. Owner command approval and manual refusal are verified. The bounded app-server-loss case and inspected recovery with a fresh owner turn in the original native conversation complete 3.5; see the dated record for limits.

## 4. Migration tooling and acceptance

- [x] 4.1 Implement quiesce/drain and a versioned closed-state exporter/importer preserving ownership, deduplication, native conversations and immutable reply associations.
- [x] 4.2 Rehearse single-consumer handoff and both rollback windows on fixture state; require post-cutover fact import before resuming an old scheduler after new acceptance.
- [x] 4.3 Run complete candidate checks, native compatibility smoke, fault acceptance and independent review; synchronize current implementation and evidence claims.
- [x] 4.4 Prepare the private activation manifest and verify the actual bot/project/audience, artifact compatibility, service inventory, backup and recovery path.
- [x] 4.5 Only after explicit activation/live-test authorization, perform the owner-chat pilot acceptance and cutover; record actual deployment and remaining gaps.

The migration CLI and supported runtime role checks have been exercised through controlled processes and temporary databases. Rehearsals cover both rollback windows, replay suppression, native conversation continuation, explicit fresh conversations, archived nullable records, interrupted role publication, snapshot integrity, source ownership and drainage. For 4.4–4.5, the owner confirmed old-service shutdown, the private M6 manifest was verified, and fresh-state preparation plus the managed single-consumer activation were observed. This deployment did not migrate old-machine task data.

The initial migration review found four defects. Their regression coverage now exercises the managed pilot recovery entry, first-turn owner loss with journal-based conversation retention, older-session rollback selection through alias lookup, and assigned group history/text/image context including quoted steering and independent stop. Complete candidate checks and independent review passed under 4.3. The subsequent bounded native interaction/recovery campaign completes 3.5.

The bounded P1 runtime/activation tasks are complete for one enrolled owner private chat. Keep the implementation PR open pending merge authorization; broader colleague/group interaction acceptance, additional process-loss families and host-login exercise remain separately unverified.

The M6 private activation manifest and scoped services have been prepared and verified. The owner authorized consolidation, confirmed old-service shutdown and completed challenge enrollment plus two fixed owner-chat turns across an idle gateway restart. Exact identities and service records stay private. The subsequent neutral-workspace change is deployed and has owner-confirmed status and no-fixed-project reply; read-only evidence verified continuation in the original native conversation with no tools and drained state. Its bounded tasks are complete. Subsequent repository/interaction/fault cases complete the bounded owner-private campaign; retain the dated evidence limits.

The [dated acceptance record](../../../docs/live-acceptance.md) records the real repository task, same-turn supplement, complete answer delivery and drained state. The same record includes the native command-stop case. The subsequent approval and process-loss records complete task 3.5.

A live refusal with leading whitespace exposed a native owner validation mismatch. The fix passed local checks, actual Hub/Worker regression, CI and independent review, and is deployed with managed readiness. The original prompt timed out without a deciding actor. A fresh owner refusal passed with a recorded deciding actor and absent target file. A subsequent approved command wrote and read back its exact marker. App-server-loss acceptance retained the unknown barrier across gateway restart; local maintenance recorded the effects inspection, and a fresh owner message completed in the original native conversation. The original fault remains unknown, with one assignment and no replay. These observations complete 3.5 and 4.5 within the bounded owner-private scope.
