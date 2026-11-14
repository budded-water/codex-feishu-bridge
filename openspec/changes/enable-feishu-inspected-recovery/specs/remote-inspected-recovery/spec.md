## ADDED Requirements

### Requirement: Scoped human inspection control

The pilot gateway SHALL accept recovery controls only from the admitted task owner who is also a configured approval administrator in the enrolled private approval chat. Recovery inspection SHALL NOT start model inference or tools, expose another conversation's incident or relax native permissions.

#### Scenario: An owner asks for recovery status
- **WHEN** the admitted owner sends `/恢复` in the enrolled private chat
- **THEN** the gateway SHALL show only that conversation's held unknown executions and bounded checkpoint readiness
- **AND** it SHALL explain the required human process/effects inspection before any confirmation

#### Scenario: Another actor or group attempts recovery
- **WHEN** a different actor, tenant, chat or group sends a recovery command
- **THEN** it SHALL NOT release a guard or reveal incident details

### Requirement: Evidence-backed exact guard release

A remote confirmation SHALL identify one immutable execution and a nonempty bounded human inspection reference. The gateway SHALL require its current unknown guard, original request ownership, a valid sealed native-child-settled checkpoint and an unreachable authenticated owner. It SHALL reject missing or changed evidence and unstarted admitted backlog. The recovery transaction SHALL record the deciding message/owner and checkpoint-bound inspection reference before releasing exactly that guard.

#### Scenario: The owner confirms inspected effects
- **WHEN** the owner confirms the exact guarded incident with valid native evidence and an inspection reference
- **THEN** the gateway SHALL release only that guard and retain the unknown historical outcome
- **AND** it SHALL preserve maintenance pause, blocked requests and revoked old launch authority
- **AND** it SHALL NOT replay a task, close a Hub business card or claim automatic external-effect verification

#### Scenario: Evidence or execution ownership is inconclusive
- **WHEN** the authenticated owner remains reachable, sealed evidence is missing or changed, the guard is absent, or unstarted admitted work remains
- **THEN** remote confirmation SHALL leave the guard and task state unchanged and require further inspection

### Requirement: Durable decision and recoverable notice

Recovery SHALL preserve source-message deduplication and repair committed decision notices through the existing durable human outbox. Uncommitted recovery commands SHALL NOT be automatically replayed after restart.

#### Scenario: The gateway loses the success notice
- **WHEN** recovery commits and the gateway or transport fails before acknowledging its notice
- **THEN** synchronization SHALL project the retained decision with stable delivery identity
- **AND** it SHALL NOT execute another recovery decision or native task

#### Scenario: A stale message targets an older incident
- **WHEN** an old recovery message is duplicated after a newer task acquires the resource
- **THEN** the original decision SHALL remain idempotent and the newer guard SHALL remain held

#### Scenario: Recovery commits before a gateway handoff
- **WHEN** a recovery decision commits before its notice is projected and the gateway closes or rolls back
- **THEN** gateway closure SHALL first preserve its durable notice intent
- **AND** rollback SHALL reject an unprojected or undelivered recovery notice before replacing runtime ownership
