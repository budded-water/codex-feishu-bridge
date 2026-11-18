# owner-task-replies Specification

## Purpose

Define owner-private Feishu task reply binding, pre-assignment input merging, exact-turn steering and verified follow-up admission.

## Requirements

### Requirement: Owner-private task reply selection

The gateway SHALL resolve a plain Feishu reply to its retained original task message for the same tenant, owner, chat and canonical project. Explicit commands SHALL retain precedence. Unrecognized references SHALL retain ordinary message handling. Specialized verification, repair and retry tasks SHALL retain their dedicated interaction paths.

#### Scenario: The owner replies to a task with other work queued

- **WHEN** the registered owner replies to one of their ordinary task messages while another task exists
- **THEN** the gateway SHALL select the individually referenced task and SHALL NOT infer the most recent task as the target

### Requirement: Durable reply disposition at execution boundaries

A recognized reply SHALL be consumed once. A queued supplement SHALL retain the original request, source event and execution identity. A live supplement SHALL bind and revalidate the original native thread, turn and executor generation. A follow-up SHALL preserve the source task and use a fresh request in the verified source conversation. Unknown effects SHALL NOT authorize any automatic follow-up for an uncertain control dispatch.

#### Scenario: A supplement commits before Worker reservation

- **WHEN** the owner replies to an unblocked request that has yet to acquire an execution permit
- **THEN** the gateway SHALL append the reply in the same admission transaction that checks for reservation
- **AND** the complete input SHALL be available at execution with one source event and one request

#### Scenario: A supplement reaches the active turn

- **WHEN** a verified owner reply targets an ordinary task with a live native turn
- **THEN** the gateway SHALL submit the input through the existing exact-target control path
- **AND** the task SHALL retain the same run and turn

#### Scenario: The original work settles before the reply can reach it

- **WHEN** the original execution has a confirmed terminal checkpoint and verified conversation, and the reply was never dispatched or the native control definitively rejected it
- **THEN** the gateway SHALL queue one linked follow-up with the new text and scoped reference to the original task
- **AND** it SHALL report this disposition without rewriting the original outcome

#### Scenario: Native acceptance remains uncertain

- **WHEN** the control may have reached the native executor and its disposition cannot be established
- **THEN** the gateway SHALL retain lookup-only reconciliation and SHALL NOT schedule a follow-up or replay the supplement

#### Scenario: Repeated delivery or gateway restart

- **WHEN** the same platform message is observed again or the gateway restarts after its disposition was committed
- **THEN** the gateway SHALL preserve the prior decision and finish any outstanding receipt projection without reapplying it
- **AND** a runtime handoff shall account for a committed receipt before it changes consumers
