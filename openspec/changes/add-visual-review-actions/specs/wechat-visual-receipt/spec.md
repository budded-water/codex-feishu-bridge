## ADDED Requirements

### Requirement: Owner decisions on screenshot receipts

New screenshot receipts SHALL allow the enrolled private owner to record visual
acceptance. A PR-specific merge action SHALL be offered only with a bound
candidate and configured repository workflow. A developer upload SHALL require
an independently selected action and a confirmed merge receipt. Each accepted
action SHALL apply to the confirmed card identity and have one durable decision.

#### Scenario: Confirm acceptance on a delivered card

- **WHEN** the enrolled owner presses the acceptance-only button on its confirmed card
- **THEN** visual acceptance is recorded for that card's candidate without starting a model
- **AND** its images and original task quotation binding remain intact

#### Scenario: Candidate changed before the merge

- **WHEN** an authorized merge is checked against a pull request with a different head
- **THEN** the workflow reports a blocked outcome without merging or uploading

#### Scenario: A write was started and its result is uncertain

- **WHEN** a write is accepted and its adapter exits without a valid result or the gateway restarts after launch
- **THEN** the card reports uncertainty and the gateway does not automatically launch that action again

#### Scenario: A local operator verifies a previously uncertain action

- **WHEN** the local operator submits inspection evidence for the exact uncertain action, candidate and destination after confirming the workflow settled
- **THEN** the gateway records the original uncertainty and inspected effect, updates the same card and requires a separate decision for any later write

#### Scenario: Upload after a confirmed merge

- **WHEN** the enrolled owner separately selects the configured developer upload on the merged card
- **THEN** the adapter receives that exact merge receipt and the declared target
- **AND** the card reports the resulting delivery receipt or blocker
