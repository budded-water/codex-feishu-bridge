## ADDED Requirements

### Requirement: Observe only the registered refund alert

The observer SHALL bind its local state to one explicitly configured SLS region, project, rule and starting time. It SHALL verify query completeness and the rule identity before persisting an evaluation. The cloud connector SHALL use only the existing read-only log-query operation and fixed query templates.

#### Scenario: A duplicate evaluation is returned by an overlapping poll

- **WHEN** polls return the same scoped evaluation ID and identity more than once
- **THEN** one evaluation SHALL be retained and at most one incident SHALL be opened for the active problem
- **AND** changing the same evaluation identity or reusing the database with another source SHALL fail without advancing progress

#### Scenario: The query is incomplete or an evaluation is from an older window

- **WHEN** an SLS response is incomplete, invalid or too large to establish the complete window
- **THEN** the checkpoint SHALL stay at the last accepted complete window
- **AND** earlier events found by overlap SHALL be retained without opening a duplicate incident
- **AND** an earlier firing or a conflicting closure evaluation that invalidates confirmed recovery evidence SHALL mark that same incident for human handoff while retaining any newer incident's independent observation schedule

### Requirement: Distinguish normalized evidence and finish within a finite schedule

The observer SHALL track an incident from the first accepted firing evaluation. It SHALL retain the evidence and the next deadline locally, independently of the process that applies the observation.

#### Scenario: Fresh observations identify the alert predicates

- **WHEN** both online channels have fresh, complete backlog samples and a fresh recovery terminal observation
- **THEN** the outcome SHALL distinguish aged backlog, missing channel identity, both predicates or a recovery health problem
- **AND** a signal from one aggregate SHALL NOT be treated as proof that individual requests are both aged and queryable

#### Scenario: Evidence is missing or the observer restarts

- **WHEN** an observation is missing, incomplete, stale or predates the required evidence boundary
- **THEN** the observer SHALL record evidence unavailable with a bounded failure reason and leave recovery unconfirmed
- **AND** restarting SHALL retain the incident identity and outstanding deadlines

#### Scenario: Follow-up finishes

- **WHEN** the two bounded follow-up slots each receive fresh, complete healthy evidence from distinct backlog and recovery batches since the latest firing evaluation, with the final evidence cutoff covered by the accepted history and a fresh inactive evaluation
- **THEN** the incident SHALL resolve
- **AND** if the final slot cannot confirm recovery, the incident SHALL reach an explicit human-handoff state

### Requirement: Keep observation outside the execution authority

The observer SHALL retain only normalized evidence and its source binding in a private local SQLite directory. It SHALL produce a local report. It SHALL NOT turn log data into task authorization, start Codex, send Feishu messages, call refund channels, invoke a Job or modify a cloud resource.

#### Scenario: Historical replay or a bounded live read runs

- **WHEN** the replay or live observer completes
- **THEN** the result SHALL identify its evidence mode
- **AND** a replay fixture SHALL NOT be represented as live fault diagnosis or repair
