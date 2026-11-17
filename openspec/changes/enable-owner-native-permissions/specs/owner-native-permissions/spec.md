## ADDED Requirements

### Requirement: Explicit scoped native policy
The optional P1 permission policy SHALL be limited to the enrolled private maintenance owner and SHALL use native read-only or workspace-write with on-request approvals and the selected native reviewer. Start, resume and subsequent task/repair turns SHALL explicitly apply that policy without granting authority from referenced content. Omission SHALL preserve existing native defaults and routing SHALL remain tool-disabled.

#### Scenario: Resuming a prior conversation
- **WHEN** an authorized task resumes a native thread
- **THEN** its configured policy is reapplied without inheriting a stale broader task override or changing unrelated native clients

### Requirement: Exact persistent command decision
Remember SHALL require a concrete supported native proposal, matching offered decision, genuine explicit owner text response or confirmed platform card, and current request identity. Only the enrolled private owner SHALL grant it. The UI SHALL disclose the complete prefix and native user-level effect. Callback input SHALL NOT supply arbitrary rules. Single approval, rejection, expiry and unavailable proposals SHALL NOT persist a rule.

#### Scenario: Remember acknowledgement is lost
- **WHEN** a submitted decision or native rule write cannot be confirmed
- **THEN** the gateway reports the distinct uncertainty, reconciles by lookup and SHALL NOT replay the command or silently resubmit the decision

### Requirement: Inspectable reversible native rules
Native files SHALL remain execution-policy authority. Rule queries SHALL be read-only and owned grant metadata SHALL distinguish presence, applicability and revocation. Explicit revocation SHALL require review for future matching uses without losing unrelated native rules or claiming immediate revocation in already-loaded executors. Configuration/backup and rollback records SHALL retain the actual persisted-policy effects.

#### Scenario: Native rules change outside the bridge
- **WHEN** observed files diverge from the recorded grant or owned revocation content
- **THEN** the bridge reports the mismatch and does not overwrite unrelated policy or claim unverified effectiveness

### Requirement: Truthful native review evidence
Native review events SHALL be identity/generation-bound and SHALL distinguish approval, denial, timeout and abort. A denied action SHALL remain unexecuted by the bridge; a timeout SHALL NOT become approval or proof of unsafe intent. Review observations alone SHALL NOT authorize task admission, replay, guard release or rule persistence.

#### Scenario: The main agent finds a safer alternative
- **WHEN** a native action was denied but the agent continues by a safer route
- **THEN** the observation preserves that denied action without manufacturing whole-task failure or automatically retrying it

### Requirement: Owner-authorized fresh denied-action retry
A supported exact native denial MAY be retried only through a new genuine enrolled-owner decision. The source SHALL be settled with valid sealed evidence, no unresolved protection and an unchanged unoccupied conversation. Admission SHALL atomically consume that denial once and retain a fresh request identity. Source history and repair limits SHALL remain unchanged.

#### Scenario: Duplicate or stale retry click
- **WHEN** the click repeats, its source evidence changes, the conversation advances, protection remains, or retry dispatch is uncertain
- **THEN** no second request, blind replay or fabricated successful authorization is permitted


### Requirement: Native authorization before fresh retry execution
The adapter SHALL recheck retained source evidence, resume its bound thread and inject the original denied-action authorization before starting the fresh requested turn. Re-review SHALL remain native. The bridge SHALL bound new-request admission, not claim an expiring OS capability or guaranteed per-tool one-use enforcement.

#### Scenario: Authorization is submitted without a turn
- **WHEN** the native denied-action authorization RPC succeeds
- **THEN** it is only an authorization marker and does not prove command execution, completion or a persistent allow rule


### Requirement: Complete native review presentation
Owner review views SHALL disclose the exact working directory, action and reason. Oversized records SHALL fall back to complete durable split text without a shortcut retry.

#### Scenario: Long or multibyte review presentation
- **WHEN** a valid native review exceeds one interactive card's character or byte budget
- **THEN** complete directory, command and reason are delivered as durable split text without admitting a retry, duplicating publication or changing source evidence
