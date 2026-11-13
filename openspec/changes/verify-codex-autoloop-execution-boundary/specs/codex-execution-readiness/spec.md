## ADDED Requirements

### Requirement: Version-matched native baseline
The executor SHALL use protocol bindings matching the deliberately selected native Codex executable and SHALL preserve its configured account identity, sandbox and approval policy.

#### Scenario: The executable and generated bindings disagree
- **WHEN** readiness verification observes a release mismatch
- **THEN** it SHALL report the incompatibility and require a reviewed binding/adapter alignment before claiming readiness
- **AND** it SHALL NOT silently relax policy, copy credentials or replace another client's executable

#### Scenario: A compatible baseline is selected
- **WHEN** the selected release is aligned
- **THEN** the repository check and real no-inference protocol smoke SHALL be recorded separately from model or live interaction acceptance

### Requirement: Isolated orchestration verification
The integration probe SHALL use a reviewed Autoloop revision, fixture-owned state and synthetic transport inputs, without changing production scheduling or consuming production work.

#### Scenario: The probe starts
- **WHEN** the native-execution probe is launched
- **THEN** its jobs and owned processes SHALL be distinguishable from production work
- **AND** it SHALL NOT activate a Feishu listener or send a platform message by default

### Requirement: Stable execution correlation
The adapter SHALL establish an execution identity before a request may have effects and SHALL correlate returned native thread/turn identifiers with the originating assignment.

#### Scenario: Start acknowledgement is lost
- **WHEN** native work may have been accepted but its start response is unavailable
- **THEN** the adapter SHALL attempt to reconcile the existing execution
- **AND** it SHALL retain an uncertain outcome rather than blindly start another write-capable attempt when reconciliation is inconclusive

### Requirement: Conversation and live-control ownership
The executor SHALL continue the intended native thread and SHALL scope live controls to the correct owner, project and active execution.

#### Scenario: The operator continues a task
- **WHEN** a correlated task is continued after a completed round
- **THEN** its next turn SHALL use the associated native conversation unless an explicitly requested new conversation is created

#### Scenario: A control targets unrelated work
- **WHEN** a status, steering or stop request does not identify work owned by the requesting session
- **THEN** it SHALL NOT affect another owner's execution

### Requirement: Live native interaction validity
Native responses SHALL target an actually pending request with the required actor and matching process generation, thread and turn. A business-round reply SHALL NOT substitute for a native approval.

#### Scenario: An approval expires or its process is replaced
- **WHEN** a response arrives after cancellation, timeout, resolution or process replacement invalidated the request
- **THEN** the adapter SHALL reject the stale response
- **AND** it SHALL NOT approve by timeout or reuse the decision for later work

### Requirement: Observed cancellation settlement
A cancellation request SHALL remain nonterminal until the execution owner has evidence that the relevant work settled, or has classified its outcome as uncertain.

#### Scenario: Interrupt acknowledgement precedes settlement
- **WHEN** the native control request is acknowledged but execution has not reached an observed terminal state
- **THEN** the integration SHALL NOT report the task as stopped or completed solely because that acknowledgement succeeded

### Requirement: Reconciled recovery and receipts
The integration SHALL distinguish executor/process loss, native completion and receipt delivery, and SHALL reconcile uncertain work before admitting another attempt that could repeat its effects.

#### Scenario: Completion occurred before receipt confirmation
- **WHEN** a worker loses its acknowledgement after native work completed
- **THEN** recovery SHALL inspect retained identity and completion evidence before rerunning anything
- **AND** result-delivery retries SHALL NOT initiate another native task

#### Scenario: The worker disappears while native work may remain
- **WHEN** a worker or lease is lost
- **THEN** its absence SHALL NOT be treated as proof that the original execution did not run or is no longer active

### Requirement: Evidence-scoped readiness decision
The P0 result SHALL distinguish format checks, simulated behavior, real protocol handshake, authorized inference, native interaction and process recovery. Unexecuted acceptance SHALL remain pending.

#### Scenario: Only fixture tests and handshake passed
- **WHEN** simulated tests and the no-inference smoke succeed without authorized model/interaction exercises
- **THEN** the result SHALL report those demonstrated boundaries
- **AND** it SHALL NOT claim live end-to-end acceptance, business-task completion or production migration readiness
