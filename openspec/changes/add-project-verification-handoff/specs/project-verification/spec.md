## ADDED Requirements

### Requirement: Explicit project-owned verification

Verification SHALL be opt-in for an exact task and trusted project profile. The project and pinned engine SHALL own required commands, suite scope and evidence validation. Chat/report data SHALL NOT select executable code or weaken required scope.

#### Scenario: Task uses a different product

- **WHEN** a new task selects another authorized project profile
- **THEN** verification SHALL use that task's source and policy without changing the workspace's global execution mode

#### Scenario: Native work changes registered acceptance policy

- **WHEN** native work changes a registered policy file or the selected suite references an unpinned verification plan
- **THEN** verification SHALL remain unverified without launching against the altered floor
- **AND** the operator SHALL review and update the trusted profile before that policy may execute

#### Scenario: Project validation receives host settings

- **WHEN** verification or its Git checks launch a child process
- **THEN** bridge, Hub and Feishu runtime variables SHALL be omitted from the child's inherited environment
- **AND** other project settings SHALL remain available without claiming filesystem isolation

### Requirement: Separate native and acceptance outcomes

Native turn completion, project verification, human review, reply delivery and release SHALL remain distinct facts. Missing, stale, mismatched, partial or unverified evidence SHALL NOT substantiate acceptance.

#### Scenario: Native answer claims success without evidence

- **WHEN** a verification-required task completes its native turn without the required verified handoff
- **THEN** the harness SHALL retain native completion and report verification as unverified rather than accepted

#### Scenario: UI requires human review

- **WHEN** the engine returns needs-review or a required environment is absent
- **THEN** the projection SHALL preserve that disposition without treating passed executed stages as complete feature acceptance

### Requirement: Durable bounded verification invocation

An authorized invocation SHALL retain exact task/source/profile/engine identity and observed output/cleanup disposition. Retry of status or delivery SHALL NOT repeat verification. An uncertain execution SHALL require reconciliation rather than automatic replay.

#### Scenario: Gateway loses the result acknowledgment

- **WHEN** a verification process may have executed and the gateway restarts
- **THEN** the same intent SHALL be reconciled without launching another invocation from the missing acknowledgment alone

#### Scenario: Verification follows a completed native turn

- **WHEN** an explicitly selected task completes its native turn and verification is running
- **THEN** its existing Worker assignment and canonical execution guard SHALL remain occupied until verified settlement or inspected uncertainty recovery
- **AND** another harness task SHALL NOT acquire execution authority during capture

#### Scenario: Native startup or turn is incomplete

- **WHEN** a selected task does not complete its native turn
- **THEN** verification SHALL be skipped without launching its child

#### Scenario: Stop and uncertain cleanup

- **WHEN** the owner stops verification or its deadline expires
- **THEN** the fixed CLI SHALL receive its supported cleanup signal
- **AND** a missing terminal handoff or incomplete cleanup after possible launch SHALL retain an unknown guard without replay

### Requirement: Canonical evidence and independent publication authority

Both canonical machine output and its required human handoff SHALL be retained and associated with the verified invocation. This result SHALL NOT authorize publication, replace required review or bypass the release owner's evidence revalidation.

#### Scenario: Source changes after observation

- **WHEN** candidate source or verification policy changes after an observed passing result
- **THEN** the observation SHALL NOT substantiate current acceptance and release readiness SHALL require fresh validation through its owning contract
- **AND** changed profiles, registered policy bytes (including ignored files), Git HEAD or report bytes SHALL be stale, while dirty source SHALL retain unverified applicability

#### Scenario: Bounded durable handoff

- **WHEN** a verified observation is projected after a long native answer
- **THEN** the verification handoff SHALL be persisted atomically with its checkpoint projection under existing message budgets
- **AND** original native chunks and sealed journals SHALL remain unchanged across retry and restart
