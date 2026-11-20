## ADDED Requirements

### Requirement: Deliver candidate-bound visual evidence to the origin task

The managed pilot SHALL accept visual evidence only through local authenticated
operator control for a completed owner-private ordinary task. Each caption and
image SHALL derive from the same selected report and checkpoint with matching
source, runtime and report/PNG hashes. Delivery SHALL reuse the same message
identity across retries and bind the acknowledged message to the original task
for quotation.

#### Scenario: Deliver two declared checkpoints together

- **WHEN** the local operator registers two reviewed scenarios for the same clean candidate and eligible execution
- **THEN** the gateway queues one reply with the actual observations and associated images
- **AND** a confirmed reply can be quoted to continue the original task

#### Scenario: Reject changed evidence before delivering

- **WHEN** the candidate, report or selected screenshot differs from its binding
- **THEN** no receipt for that submission is queued
