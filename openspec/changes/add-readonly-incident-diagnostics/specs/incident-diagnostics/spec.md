## ADDED Requirements

### Requirement: Bounded task-bound process observations

The native owner SHALL retain private process observations bound to its execution/request identity. Observations SHALL include OS process identity and parent identity edges, exclude unrelated owner children, remain bounded, and stop before terminal publication. Sampling SHALL NOT terminate processes or change native execution authority.

#### Scenario: A registered descendant outlives the native process
- **WHEN** a previously observed matching descendant remains after its native parent exits
- **THEN** diagnostics SHALL report that registered identity as running when the current OS observation matches
- **AND** the report SHALL preserve the sampled-coverage limitation

#### Scenario: Process identity or metadata cannot be established
- **WHEN** PID identity changed, sampling failed, or metadata is missing, invalid or bound to another request
- **THEN** the affected observation SHALL be unverified
- **AND** it SHALL NOT imply all descendants exited or grant recovery authority

### Requirement: Read-only owner-private incident report

The existing enrolled owner/private-chat/approval-role boundary SHALL gate diagnostic collection. The report SHALL bind native, process, queue and source observations to the exact held incident, include observation time and coverage, and keep missing facts explicit. Collection SHALL NOT change admission, native journals, native conversations or Hub state or start inference.

#### Scenario: The owner views an uncertain incident
- **WHEN** an authorized owner sends `/恢复`
- **THEN** the reply SHALL show verified, running or unverified observations with the exact incident ID
- **AND** business effects SHALL remain a human inspection obligation
- **AND** no task, guard, pause, queue or conversation reference SHALL change as a result of collecting the report

#### Scenario: Another actor requests the report
- **WHEN** a different actor, tenant, chat or group sends the command
- **THEN** it SHALL NOT collect or disclose incident diagnostics

### Requirement: Source-scoped scheduler observation

Hub diagnostics SHALL use only the retained event and existing source read capability. They SHALL validate the expected route and assigned run before reporting a supported scheduler state and SHALL NOT publish, retry, resolve cards or mutate routing.

#### Scenario: Hub reports a completed scheduler round
- **WHEN** the bound Hub run reports `done` for an unknown native execution
- **THEN** the report SHALL distinguish scheduler state from the retained unknown task outcome

#### Scenario: Hub observation is missing or inconsistent
- **WHEN** the service is unavailable or event, route or assignment does not match retained identity
- **THEN** the scheduler observation SHALL be unverified without mutating the request

### Requirement: Compatible evidence retention

Compatible migration and rollback SHALL retain optional process metadata alongside closed native evidence. Older executions without that metadata SHALL remain readable with unverified process coverage. Diagnostic snapshots SHALL NOT replace confirmation-time recovery validation.

#### Scenario: A closed execution is archived
- **WHEN** compatible tooling archives a closed execution containing process observations
- **THEN** the metadata SHALL be retained with the existing native evidence integrity checks
- **AND** the original outcome and recovery authorization semantics SHALL remain unchanged
