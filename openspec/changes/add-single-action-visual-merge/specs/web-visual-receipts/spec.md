## MODIFIED Requirements

### Requirement: Visual acceptance without delivery execution

A Web screenshot receipt without explicit merge intent SHALL offer only
visual acceptance and retain its original task association. The separate
single-action merge requirement governs receipts enrolled for merge.

#### Scenario: The owner confirms a displayed screenshot
- **WHEN** the authorized owner selects acceptance on the confirmed review-only Web receipt
- **THEN** the same card records the owner's visual acceptance
- **AND** the action does not start a model, verifier, merge, upload or deployment
