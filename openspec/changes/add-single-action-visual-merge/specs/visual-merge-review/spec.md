## ADDED Requirements

### Requirement: Single-action merge on eligible visual receipts

A Web screenshot receipt with explicit merge intent SHALL require a bound PR
and a registered workflow with independently authorized release. Eligible
WeChat receipts MAY use the same workflow. The enrolled approver SHALL see
one merge button. Its authorization SHALL bind the confirmed Feishu message,
repository, PR, target branch and exact reviewed head.

#### Scenario: Conflict or changed candidate
- **WHEN** the workflow confirms a conflicting PR or a candidate head change
- **THEN** the same card displays the reason and creates no release question
- **AND** a quoted repair request continues the original task

#### Scenario: Provider confirms the merge
- **WHEN** the provider confirms the bound merge
- **THEN** the gateway records the outcome and one release question together
- **AND** quoting the question continues the original task with its merge identity
- **AND** the original click grants only merge authority

#### Scenario: The release question delivery is unconfirmed
- **WHEN** the question cannot be confirmed before the Feishu deduplication deadline
- **THEN** the gateway records the unconfirmed delivery and stops retrying it
- **AND** ordinary replies and native prompts remain independently deliverable

#### Scenario: Provider effect is uncertain
- **WHEN** a started attempt loses its provider result
- **THEN** the gateway retains uncertainty, posts no release question and performs no replay
- **AND** checked reconciliation to a confirmed merge durably queues one release question
