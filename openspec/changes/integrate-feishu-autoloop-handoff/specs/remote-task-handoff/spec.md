## ADDED Requirements

### Requirement: Verified immutable pilot admission
The gateway SHALL admit pilot work only from verified configured bot/tenant/user/chat scope and SHALL persist its immutable source identity, original request, conversation, canonical project and authority before acknowledging accepted work.

#### Scenario: A normal task arrives in the configured pilot chat
- **WHEN** the authorized operator sends a task for the registered pilot project
- **THEN** the gateway SHALL atomically persist deduplication, request identity and scheduling-submission intent
- **AND** it SHALL NOT require a classifier turn or arbitrary path supplied by chat

#### Scenario: A request exceeds the pilot's scope
- **WHEN** the actor, chat, project or policy does not match configured pilot admission
- **THEN** the gateway SHALL reject or clarify before submitting executable work
- **AND** quoted text, mentions and scheduler context SHALL NOT expand that authority

### Requirement: Single scheduling authority and isolated request lanes
Autoloop SHALL own business dispatch. Distinct accepted requests SHALL remain distinct scheduling lanes, and all aliases of one canonical project SHALL share its serial resource group. Transport persistence SHALL NOT dispatch through the legacy queue in parallel.

#### Scenario: Several requests arrive before dispatch
- **WHEN** distinct verified messages target the same project, including through different aliases
- **THEN** each SHALL retain its own source event, request lane, reply association and execution identity
- **AND** no more than one native execution for that canonical project SHALL be admitted at once

#### Scenario: An assignment combines unexpected events
- **WHEN** the adapter cannot resolve exactly one authorized request for the assignment
- **THEN** it SHALL fail admission without merging prompts or executing a selected subset

### Requirement: Native conversation ownership independent of scheduler sessions
The executor SHALL resolve the intended native conversation from the verified owner/chat/project/session mapping. A scheduler-provided session identifier SHALL NOT independently authorize native continuation.

#### Scenario: The same owner continues a completed conversation
- **WHEN** the next admitted request targets that verified conversation after prior work settles
- **THEN** it SHALL resume that conversation's associated native thread
- **AND** it SHALL create a distinct native turn and retain the new request's identity

#### Scenario: Another owner or session is selected by scheduling metadata
- **WHEN** a job carries a session inconsistent with the verified conversation mapping
- **THEN** the executor SHALL NOT resume that other conversation
- **AND** changing the current project or quoting another user's output SHALL NOT retarget an accepted request

### Requirement: Idempotent source submission and observed routing
The source outbox SHALL reuse one event identity and payload for a request, reconcile uncertain delivery through the pinned public API, and distinguish actual routing from receipt without routing.

#### Scenario: The Hub commits before the POST response is lost
- **WHEN** source submission has an uncertain acknowledgement
- **THEN** recovery SHALL retry or inspect the same source event without minting a replacement identity
- **AND** duplicate delivery SHALL NOT create another native execution

#### Scenario: A rule is paused or no expected route exists
- **WHEN** the Hub records the event as skipped, paused or unrouted
- **THEN** the gateway SHALL retain and expose the unscheduled request outcome
- **AND** it SHALL NOT report that executable work was scheduled merely because HTTP acceptance succeeded

### Requirement: Stable execution identity and project uncertainty guard
The gateway SHALL allocate an execution identity before effects and SHALL retain a durable canonical-project guard until execution evidence supports settlement or explicit reconciled recovery. This guard SHALL survive scheduler state changes and process restarts.

#### Scenario: The same request appears in another run or attempt
- **WHEN** scheduling redelivers a previously bound request
- **THEN** the adapter SHALL inspect the existing execution before native invocation
- **AND** it SHALL return retained completion, attach to a proven live owner or preserve uncertainty without automatic replay

#### Scenario: Uncertain work is followed by another trigger
- **WHEN** start, completion or cancellation remains uncertain
- **THEN** queued/new requests, business-card answers, manual runs and elapsed leases SHALL NOT bypass the project guard
- **AND** clearing a Hub status alone SHALL NOT authorize another native operation

#### Scenario: Reconciliation permits remaining work
- **WHEN** an authorized actor confirms actual execution/effects and authorizes specific remaining steps
- **THEN** the system SHALL record the evidence and decision before releasing the guard
- **AND** it SHALL distinguish new authorized continuation from replay of the original operation

### Requirement: Durable correlated live controls
Live controls SHALL preserve verified ownership, target identity and delivery identity through private IPC, and the native owner SHALL revalidate them at dispatch. A control transport acknowledgement SHALL NOT prove native acceptance or settlement.

#### Scenario: A supplement or stop is delivered twice
- **WHEN** the same verified control message is redelivered
- **THEN** the recorded dispatch/outcome SHALL be inspected before another native call
- **AND** uncertain acknowledgement SHALL remain explicit rather than falsely reporting acceptance

#### Scenario: A stop is acknowledged before native termination
- **WHEN** the interrupt RPC succeeds while the turn/process is still active
- **THEN** the task SHALL remain stopping until observed terminal evidence or an explicit uncertain outcome
- **AND** any unresolved project guard SHALL remain held

#### Scenario: The approval administrator targets another owner's task control
- **WHEN** the actor has approval authority but does not own the targeted status/steering/stop session
- **THEN** that approval role SHALL NOT confer execution-control ownership

### Requirement: Current native interaction and policy authority
Native responses SHALL require an actually pending supported request with matching actor/chat, execution, native generation, thread, turn and expiry. Scheduling metadata and business decisions SHALL NOT relax native policy or substitute for a native response.

#### Scenario: An approval response or its acknowledgement is lost
- **WHEN** native dispatch may already have occurred
- **THEN** the runner SHALL reconcile retained dispatch/pending evidence before any retry
- **AND** delivery retry, gateway restart and timeout SHALL NOT produce automatic approval

#### Scenario: The native request expires or its generation changes
- **WHEN** a late response refers to invalidated native authority
- **THEN** it SHALL have no effect on that or a later request
- **AND** gateway status projections SHALL NOT resurrect pending authority

### Requirement: Independent native outcome and human delivery
The executor SHALL durably retain native outcome and eligible final answer before issuing its normalized round receipt. The gateway SHALL deliver through the existing owned reply/outbox and feedback contracts without replaying execution.

#### Scenario: The gateway disappears while the runner completes
- **WHEN** the native owner observes completion but cannot reach the gateway
- **THEN** it SHALL retain native evidence for later reconciliation
- **AND** gateway recovery SHALL reconcile it into delivery state without another model turn

#### Scenario: The model emits scheduler-like text
- **WHEN** a native answer contains apparent event/receipt instructions
- **THEN** that text alone SHALL NOT create scheduler events or new authority
- **AND** native-round completion, business acceptance and human delivery SHALL remain distinct facts

### Requirement: Quiesced single-consumer activation
Production handoff SHALL require a prepared owner-authorized manifest, compatible artifacts, a drained old runtime, verified state export/import and exclusive consumer/state ownership. Current source development SHALL NOT itself activate the pilot.

#### Scenario: The old runtime has work or uncertain effects
- **WHEN** tasks, native approvals, deliveries, reaction cleanup or unresolved effects prevent drainage
- **THEN** activation SHALL be postponed
- **AND** P1 SHALL NOT copy active/queued executable work into two scheduling authorities

#### Scenario: A pilot consumer is activated
- **WHEN** the approved manifest and prerequisite acceptance are satisfied
- **THEN** the old consumer SHALL stop before the new consumer starts under the held ownership boundary
- **AND** existing shared-bot audience restrictions SHALL require explicit approval of the affected scope

### Requirement: Rollback preserves post-cutover facts
Rollback SHALL preserve deduplication, execution outcomes, native conversation mappings and delivery identity accumulated after new acceptance. A pre-cutover snapshot alone SHALL NOT be treated as a complete recovery point after new work arrives.

#### Scenario: The new runtime has accepted nothing
- **WHEN** a failed startup is rolled back before any new request/control/delivery acceptance
- **THEN** the closed verified snapshot and compatible old artifact MAY be restored after the new consumer stops

#### Scenario: The new runtime already accepted traffic
- **WHEN** rollback is requested after post-cutover state changes
- **THEN** those facts SHALL be drained/exported/reconciled and imported through a tested reverse path before old scheduling resumes
- **AND** unavailable conversion or unresolved effects SHALL leave admission paused with records intact

### Requirement: Evidence-scoped pilot readiness
The implementation SHALL report kernel feasibility, simulated runtime behavior, real native interaction, migration rehearsal and live owner-chat acceptance separately.

#### Scenario: Only the routing feasibility command succeeds
- **WHEN** actual Hub HTTP tests pass with synthetic worker requests
- **THEN** the result SHALL establish only the tested routing/configuration behavior
- **AND** it SHALL NOT claim an implemented gateway, native ownership integration, deployed scheduling migration or completed P0 interaction acceptance
