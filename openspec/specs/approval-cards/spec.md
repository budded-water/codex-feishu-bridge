# approval-cards Specification

## Purpose
Define complete reviewable approval presentation, authenticated exact-target callbacks and durable card updates while preserving native request authority, expiry and sealed evidence compatibility.

## Requirements

### Requirement: Reviewable approval presentation

The private same-chat approval SHALL show purpose, complete redacted action, context/deadline and approve-once/reject buttons. Other supported scopes or oversized presentation SHALL retain a complete, structured manual-command preview. Presentation SHALL NOT hide or truncate an action to permit approval.

#### Scenario: Mobile approval

- **WHEN** the owner receives an eligible approval
- **THEN** the action and single-request authorization scope SHALL precede the decision controls without duplicated request text or internal workspace labels
- **AND** once/reject controls SHALL remain distinct from a full-width optional native Remember control, whose complete literal prefix and user-wide scope SHALL precede that control
- **AND** pending action, prefix and authorization scope SHALL remain expanded; only secondary request metadata/manual commands MAY collapse

### Requirement: Exact authenticated callback

Only a verified SDK callback for an acknowledged card message, matching tenant/chat and configured approval actor, SHALL enter the existing approval path. It SHALL bind to the original execution and native target, preserve expiry and use a durable event identity. Uncertain dispatch SHALL remain lookup-only.

#### Scenario: Old card during newer work

- **WHEN** a stale card is clicked while another task is active
- **THEN** no new task or native request SHALL receive that decision

#### Scenario: Delivery acknowledgement is missing

- **WHEN** a callback arrives before delivery identity is confirmed
- **THEN** it SHALL be rejected without inferring message ownership or sending a native decision

### Requirement: Prompt callback response and durable UI

Callback response SHALL require only local validation/admission and SHALL NOT wait for model, native or platform I/O. Acknowledged cards SHALL update through durable transport after decision submission, expiry or invalidation. Settled cards SHALL lead with the submission/expiry outcome, retain inspectable historical details and expose no decision controls. Update retries SHALL NOT repeat execution or approve requests.

#### Scenario: Competing or duplicate clicks

- **WHEN** callbacks repeat or choose competing decisions
- **THEN** only the live native request's first valid decision SHALL be sent and later clicks SHALL remain ineffective

### Requirement: Historical evidence compatibility

Legacy optional-column journals SHALL remain readable without mutation. New presentation/update data and callback identities SHALL survive transport restart and compatible archival/rollback, with required delivery drained before role conversion.

#### Scenario: Existing sealed journal

- **WHEN** the gateway reads evidence created before cards
- **THEN** projection SHALL read it without migrating or changing its bytes
