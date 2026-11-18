## ADDED Requirements

### Requirement: The enrolled owner can select an independent matter

The managed gateway SHALL allow the enrolled private owner to create and select named matters that keep separate durable native conversation bindings. Selection and list queries SHALL NOT start an executor.

#### Scenario: Two matters use separate histories

- **WHEN** the enrolled owner creates two named matters and submits tasks through their respective selections
- **THEN** distinct conversation IDs SHALL be bound to those requests and subsequent selections SHALL resolve to the same respective conversations after restart

#### Scenario: A trusted reference takes precedence

- **WHEN** an ordinary message includes a confirmed matter-card reference, an exact matter title or a registered GitHub pull request for a different matter
- **THEN** the new request SHALL use the explicitly resolved matter regardless of the current selection
- **AND** exact replies to original tasks SHALL preserve existing queue merge, live steer and settled follow-up semantics

### Requirement: Ambiguous tasks require explicit selection

The managed gateway SHALL persist ambiguous inputs before offering owner-scoped choices. It SHALL allow only confirmed choices from the same tenant, user, chat and message to consume the original input.

#### Scenario: Choice is committed exactly once

- **WHEN** an ambiguous message is received and the owner later chooses a valid target on its delivered card
- **THEN** the gateway SHALL atomically consume the choice and admit the original message into the chosen conversation
- **AND** duplicate deliveries and repeated choices SHALL NOT admit another request, change its destination or override a newer selection

#### Scenario: An earlier refusal is replayed

- **WHEN** Feishu redelivers an input that was refused during maintenance or required resubmission
- **THEN** the gateway SHALL retain the refusal even if the selection or registered objects subsequently change

#### Scenario: The transport acknowledgement is incomplete

- **WHEN** delivery fails or a response has no confirmed platform message ID
- **THEN** the gateway SHALL retain the same outgoing card identity for recovery
- **AND** a card SHALL become actionable only after binding its confirmed platform message ID

#### Scenario: Existing records remain usable

- **WHEN** the gateway opens an existing state database
- **THEN** the prior default conversation and its requests, native thread and references SHALL retain their identities
- **AND** the canonical project guard SHALL still prevent overlapping work across matters using that resource
