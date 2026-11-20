# Owner delivery checkpoints

## ADDED Requirements

### Requirement: Exact evidence and task association

The enrolled private operator who can use maintenance commands SHALL be able to
register one immutable evidence reference against a completed ordinary task
whose current conversation and terminal evidence can be checked. The checkpoint
SHALL survive restart. An inspection SHALL show whether it awaits confirmation
or has admitted the linked continuation. It SHALL be read-only with respect to
admission and launch state.

#### Scenario: Mobile and Web references share one contract

- **WHEN** the operator registers a mobile candidate or a Web preview using its
  opaque version-bound reference
- **THEN** the same checkpoint mechanism records and retrieves the reference
- **AND** the reference remains an operator observation

### Requirement: Owner-confirmed continuation

An explicit owner confirmation SHALL match the exact retained evidence reference
and contain the next task. The checkpoint consumption and ordinary linked
request SHALL commit together. The existing thread validation, execution guard,
deduplication and native tool policy SHALL apply. Confirmation SHALL carry no
additional tool, verification or publication authority.

#### Scenario: Restart and repeated confirmation

- **WHEN** the owner confirms the same reference after restart
- **THEN** one linked request is admitted for the original conversation
- **AND** a duplicate or second confirmation does not create another request

#### Scenario: Stale target or uncertain execution

- **WHEN** the reference differs, the original thread has changed, the source
  became uncertain or the current project cannot safely advance
- **THEN** no continuation is admitted
- **AND** the checkpoint remains available for inspection
