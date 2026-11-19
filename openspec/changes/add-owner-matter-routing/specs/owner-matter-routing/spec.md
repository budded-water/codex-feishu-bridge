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

#### Scenario: An owner replies to a confirmed final answer

- **WHEN** the owner replies with a new ordinary question to a confirmed successful ordinary Bot answer, including while another matter is selected
- **THEN** the gateway SHALL use the original task's confirmed conversation and schedule a follow-up turn through the existing task-reply path
- **AND** an unconfirmed delivery, other chat or actor, prompt, status fallback, or special procedure SHALL NOT become an ordinary answer anchor
- **AND** a request explicitly targeting a registered project outside the pilot SHALL still be refused

#### Scenario: The receipt identifies the admitted matter

- **WHEN** an ordinary request is accepted in a chat with named matters
- **THEN** the gateway SHALL include the actual admitted matter or default conversation in a single receipt, independent of the current selection

### Requirement: Ambiguous tasks require explicit selection

The managed gateway SHALL persist ambiguous inputs before offering owner-scoped choices. It SHALL allow only confirmed choices from the same tenant, user, chat and message to consume the original input.

#### Scenario: Choice is committed exactly once

- **WHEN** an ambiguous message is received and the owner later chooses a valid target on its delivered card
- **THEN** the gateway SHALL atomically consume the choice and admit the original message into the chosen conversation
- **AND** duplicate deliveries and repeated choices SHALL NOT admit another request, change its destination or override a newer selection

#### Scenario: Explicit matter addresses disagree

- **WHEN** the confirmed matter card, exact title or registered PR resolves to different matters in a new message
- **THEN** the gateway SHALL hold the message for a confirmed choice
- **AND** a read-only request addressed to a confirmed matter card SHALL use the matter route, while a reply to an exact original task retains task-control behavior

#### Scenario: A short unanchored follow-up arrives after switching

- **WHEN** the owner switches away from a matter with admitted work and sends a short vague continuation before admitting a task in the selected matter
- **THEN** the gateway SHALL persist the original message and offer the previous and current matters before execution
- **AND** a verified selection, a valid explicit destination, or a new task already admitted to the selected matter SHALL permit ordinary continuation without re-asking about that switch

#### Scenario: A quoted reference is awaiting confirmation

- **WHEN** the owner quotes an unconfirmed parent while named matters exist and supplies no other explicit matter address
- **THEN** the gateway SHALL ask for a choice before dispatching
- **AND** a redelivery after the parent appears SHALL keep any previously held or refused disposition

#### Scenario: An explicit steering command quotes a non-task reference

- **WHEN** a private owner with named matters quotes a matter card or an unconfirmed parent and sends `/steer`
- **THEN** the gateway SHALL ask for the original running task reference and SHALL NOT steer the active turn

#### Scenario: An earlier refusal is replayed

- **WHEN** Feishu redelivers a command or card action refused during maintenance, or a message that was refused by project routing or required resubmission
- **THEN** the gateway SHALL retain the refusal even if the selection or registered objects subsequently change

#### Scenario: The transport acknowledgement is incomplete

- **WHEN** delivery fails or a response has no confirmed platform message ID
- **THEN** the gateway SHALL retain the same outgoing card identity for recovery
- **AND** a card SHALL become actionable only after binding its confirmed platform message ID

#### Scenario: Rollback reaches a retained, unprojected response

- **WHEN** reverse conversion finds a committed matter response or clarification card that has not been projected
- **THEN** it SHALL preserve the existing gateway as owner and wait for the response to be projected and drained

#### Scenario: Existing records remain usable

- **WHEN** the gateway opens an existing state database
- **THEN** the prior default conversation and its requests, native thread and references SHALL retain their identities
- **AND** the canonical project guard SHALL still prevent overlapping work across matters using that resource
