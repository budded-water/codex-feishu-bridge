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
- [ ] 3.5 Complete P0's pending bounded native steering, approval/rejection and process-loss acceptance in the dedicated pilot scope.

For 3.1–3.2, verify:assigned-native connects the public plugin Turn/context, actual claimed source run, retained request and native conversation. It verifies Worker restart, checkpoint reuse, native continuation, approval ownership, observed stop and uncertain process outcomes. The --native mode verifies two fixed-text turns in one native conversation with no tool execution items. Tasks 3.3–3.4 now have durable gateway/native control records and full native prompt/result projections through existing Outbox/Feedback. Tests cover uncertain/lost acknowledgements without replay, actor/generation/quote targeting, gateway outage, delayed stale prompts, stable-ID result retries, separate reaction cleanup, source-route blockage and stop/completion races. The actual Hub/Worker verifier also uses this programmatic gateway with synthetic human transport. Migration and live listener activation remain in section 4. Real-model steering/approval/rejection/process-loss acceptance in 3.5 remains open.

## 4. Migration tooling and acceptance

- [ ] 4.1 Implement quiesce/drain and a versioned closed-state exporter/importer preserving ownership, deduplication, native conversations and immutable reply associations.
- [ ] 4.2 Rehearse single-consumer handoff and both rollback windows on fixture state; require post-cutover fact import before resuming an old scheduler after new acceptance.
- [ ] 4.3 Run complete candidate checks, native compatibility smoke, fault acceptance and independent review; synchronize current implementation and evidence claims.
- [ ] 4.4 Prepare the private activation manifest and verify the actual bot/project/audience, artifact compatibility, service inventory, backup and recovery path.
- [ ] 4.5 Only after explicit activation/live-test authorization, perform the owner-chat pilot acceptance and cutover; record actual deployment and remaining gaps.

These unchecked runtime/activation tasks are not claims of shipped P1 behavior. Contract/feasibility work can be reviewed independently while P0 remains open for its unexecuted native acceptance.
