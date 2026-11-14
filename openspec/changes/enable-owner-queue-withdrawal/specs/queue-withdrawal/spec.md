## ADDED Requirements

### Requirement: Exact private-owner withdrawal

Only the enrolled private owner satisfying the approval-role boundary SHALL view or withdraw that conversation's unstarted requests. Selection SHALL use the exact execution identity or an explicit quote of its original admitted message. Listing SHALL be bounded and exclude task/command/credential/path content.

#### Scenario: Unauthorized or ambiguous target

- **WHEN** another user, tenant or chat sends a control, or the selector and quote conflict
- **THEN** no request SHALL be withdrawn or disclosed to that actor

### Requirement: Atomic no-launch decision

Withdrawal SHALL atomically retain deciding message/actor and prior block reasons while prohibiting native reservation for the selected request. Any existing execution SHALL prevent withdrawal. Original request/event/assignment history SHALL remain retained.

#### Scenario: Reservation wins the race

- **WHEN** an execution permit commits before withdrawal
- **THEN** withdrawal SHALL refuse and preserve the execution and guard

#### Scenario: Withdrawal wins an in-flight source confirmation

- **WHEN** withdrawal commits while a source publication or inspection is awaiting a response
- **THEN** the late response SHALL NOT authorize a native launch or remove the withdrawal

### Requirement: Durable notice and reversal

Committed withdrawals SHALL project a stable owner-message-bound notice and terminal transport feedback after restart. Rollback SHALL require projected and drained withdrawal notices, retain the pilot ledger archive and preserve command deduplication in reverse conversion.

#### Scenario: Acknowledgement or gateway is lost

- **WHEN** notice projection or delivery is interrupted
- **THEN** recovery SHALL repair delivery from the retained receipt without repeating execution or changing withdrawal identity

### Requirement: Separate control boundaries

Withdrawal SHALL NOT terminate processes, release unknown guards, alter sealed evidence, resume pause, cancel Hub runs/cards or start model inference. Withdrawn history SHALL NOT count as pending or blocked work.

#### Scenario: Unknown guard and queued request coexist

- **WHEN** the owner withdraws an unstarted request
- **THEN** the unknown task's guard and outcome SHALL remain unchanged until separate inspected recovery
