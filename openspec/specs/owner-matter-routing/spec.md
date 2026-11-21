# owner-matter-routing Specification

## Purpose
Define owner-private Feishu matter selection, verified task and answer references, labeled receipts and durable clarification before native task admission.

## Requirements

### Requirement: The enrolled owner can select an independent matter

The managed gateway SHALL allow the enrolled private owner to create and select named matters that keep separate durable native conversation bindings. Selection and list queries SHALL NOT start an executor.

#### Scenario: Two matters use separate histories

- **WHEN** the enrolled owner creates two named matters and submits tasks through their respective selections
- **THEN** distinct conversation IDs SHALL be bound to those requests and subsequent selections SHALL resolve to the same respective conversations after restart

#### Scenario: A trusted reference takes precedence

- **WHEN** an ordinary message includes a confirmed matter-card reference, an exact matter title or a registered GitHub pull request that resolves to one matter without a conflicting verified reference
- **THEN** the new request SHALL use the explicitly resolved matter regardless of the current selection
- **AND** exact replies to original tasks SHALL preserve existing queue merge, live steer and settled follow-up semantics

#### Scenario: An owner replies to a confirmed final answer

- **WHEN** the owner replies with a new ordinary question to a confirmed successful ordinary Bot answer, including while another matter is selected, and the reply contains no conflicting exact title or registered PR
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

#### Scenario: A confirmed answer and the reply text disagree

- **WHEN** the owner replies to a confirmed ordinary final answer and an exact title or registered PR in the reply addresses another matter
- **THEN** the gateway SHALL retain the original reply and confirmed answer identity and require a choice before admitting any work
- **AND** selecting the answer's matter SHALL use the existing verified task-reply checks and original conversation
- **AND** selecting another candidate SHALL admit a new ordinary request in that matter using the submitted content without importing the quoted answer or its conversation history
- **AND** a refused follow-up SHALL consume the selected response once without changing the current focus
- **AND** exact replies to the owner's original task SHALL retain their existing semantics

#### Scenario: A short unanchored follow-up arrives after switching

- **WHEN** the owner switches matters and sends a recognized short unanchored continuation before admitting new ordinary work, and the latest admitted ordinary request predating the switch belongs to a different matter
- **THEN** the gateway SHALL persist the original message and offer the recent and current matters before execution
- **AND** a verified routing choice, explicit confirmation of the current selection, a valid explicit destination, or a new ordinary task already admitted to the selected matter SHALL permit ordinary continuation without re-asking about that switch
- **AND** a later withdrawal SHALL preserve the task's original admission for this routing decision

#### Scenario: The most recent admitted ordinary task used a different matter

- **WHEN** the owner sends a recognized short unanchored continuation and the latest ordinary owner-private request admitted since the latest selection or confirmation used a different matter than the current selection
- **THEN** the gateway SHALL hold the input for a choice between the two matters
- **AND** the gateway SHALL use durable admission order, excluding specialized procedures and delivery timing
- **AND** an explicitly addressed request SHALL NOT implicitly switch the current selection

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
- **AND** previously confirmed selections SHALL stay confirmed through the schema upgrade
- **AND** the canonical project guard SHALL still prevent overlapping work across matters using that resource

### Requirement: A first request can start a fresh matter

The enrolled private owner SHALL be able to start a separate matter and send
its first ordinary request in one message. Routing SHALL preserve the
original message identity and bound each successful request to the same
canonical project admission and execution rules.

#### Scenario: Explicit fresh topic in one message

- **WHEN** the enrolled owner sends a recognized new-topic phrase with a nonempty ordinary request
- **THEN** the gateway SHALL admit the remaining text into a new conversation and select that matter
- **AND** an older quoted conversation or registered PR binding SHALL retain its identity and SHALL NOT supply its history to the new conversation

#### Scenario: A direct request names an unbound PR

- **WHEN** an unquoted direct read or review request names a single exact GitHub PR without another verified destination
- **THEN** the gateway SHALL admit it to its existing bound matter or start and bind one fresh matter
- **AND** a duplicated Feishu message SHALL NOT create another conversation, request or receipt

#### Scenario: The owner chooses a new topic for a held message

- **WHEN** the confirmed choice card for a held message offers a new topic and the enrolled owner chooses it
- **THEN** the gateway SHALL admit the saved message once, without requiring it to be sent again
- **AND** a duplicate click or restart SHALL retain its first destination

#### Scenario: An unquoted question concerns the preceding message

- **WHEN** an unquoted question uses a recognized Chinese prior-message opening such as `上一条的` or `上一轮里`, a matter is selected, and the message has no additive-subject wording, explicit destination or other complete matter title
- **THEN** shared words in matter titles SHALL NOT take precedence over the selected matter and ordinary admission history
- **AND** if the last eligible task and the selected matter differ, the gateway SHALL present both choices before admission

#### Scenario: Routing receipt explains the result

- **WHEN** a new matter is admitted or a known matter is continued
- **THEN** the existing receipt SHALL identify the actual destination and distinguish a new conversation from a continuation where that fact is established
- **AND** a withheld or blocked request SHALL NOT claim to have started execution
