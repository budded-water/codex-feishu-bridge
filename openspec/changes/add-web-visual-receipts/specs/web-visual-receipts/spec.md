## ADDED Requirements

### Requirement: Owner-selected Web screenshot receipts

The gateway SHALL accept an explicitly selected Web screenshot plan through the authenticated local receipt command. It SHALL verify the clean candidate, task ownership, and bounded PNG bytes against the operator's hashes, and deliver a native Feishu image through its durable outbox.

#### Scenario: A completed owner-private task has a candidate screenshot

- **WHEN** the operator selects one to three PNGs from the dedicated directory inside the clean candidate worktree and submits a private plan for the completed task
- **THEN** the gateway delivers one receipt replying to the original owner-private task, with tappable Feishu images and its candidate identity
- **AND** duplicate selection retains the original delivery identity

#### Scenario: An image or candidate has changed

- **WHEN** the candidate is dirty, the snapshot is out of scope, or its hash does not match the private plan
- **THEN** the gateway rejects the plan without registering a new delivery for that invalid selection

### Requirement: Visual acceptance without delivery execution

An operator-selected Web screenshot receipt SHALL use the existing confirmed-message and owner checks for visual acceptance. It SHALL expose only the acceptance decision and retain its original task association.

#### Scenario: The owner confirms a displayed screenshot

- **WHEN** the authorized owner selects the acceptance action on the confirmed Web receipt
- **THEN** the same card records the owner's visual acceptance
- **AND** the action does not start a model, verifier, merge, upload or deployment
