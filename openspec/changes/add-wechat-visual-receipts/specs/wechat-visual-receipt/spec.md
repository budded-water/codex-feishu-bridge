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

#### Scenario: Original Feishu message can no longer be replied to

- **WHEN** Feishu reports that the original message was recalled or deleted
- **THEN** the receipt retains an unavailable reply-target result
- **AND** the gateway does not publish a standalone image post

#### Scenario: Slow image upload overlaps an ordinary reply

- **WHEN** a receipt is waiting for an image upload
- **THEN** ordinary replies and native prompts can continue independently
- **AND** an acknowledged upload is reused when the receipt is retried

#### Scenario: A receipt reaches its bounded delivery window without acknowledgement

- **WHEN** a receipt is still pending at its delivery deadline
- **THEN** the gateway retains an unconfirmed result and stops automatic sends
- **AND** submitting the exact same plan can inspect that result without requeueing it
