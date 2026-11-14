## ADDED Requirements

### Requirement: Explicit project-owned verification

Verification SHALL be opt-in for an exact task and trusted project profile. The project and pinned engine SHALL own required commands, suite scope and evidence validation. Chat/report data SHALL NOT select executable code or weaken required scope.

#### Scenario: Task uses a different product

- **WHEN** a new task selects another authorized project profile
- **THEN** verification SHALL use that task's source and policy without changing the workspace's global execution mode

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

### Requirement: Canonical evidence and independent publication authority

Both canonical machine output and its required human handoff SHALL be retained and associated with the verified invocation. This result SHALL NOT authorize publication, replace required review or bypass the release owner's evidence revalidation.

#### Scenario: Source changes after observation

- **WHEN** candidate source or verification policy changes after an observed passing result
- **THEN** current applicability SHALL be stale and release readiness SHALL require fresh validation through its owning contract
