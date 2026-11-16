## ADDED Requirements

### Requirement: Owner-scoped bounded discovery view
The P1 gateway SHALL expose `/findings` only to its enrolled private owner with the existing maintenance approval role. It SHALL derive leads from at most the latest 100 verification-bearing requests in that owner/chat and canonical resource, select the latest admitted request per profile and display at most 10 non-pass profiles. It SHALL disclose selection limits and SHALL NOT claim omitted or superseded observations are resolved.

#### Scenario: Newer work replaces an older lead
- **WHEN** a profile has an older failed observation and a newer passing, queued or interrupted task
- **THEN** the view uses only the newer task for that profile while the old exact history remains available

#### Scenario: Unauthorized or malformed discovery request
- **WHEN** a different user/chat/tenant, a group, an owner without the approval role or an invalid `/findings` request arrives
- **THEN** no history is disclosed and no native task is admitted

### Requirement: Evidence-qualified historical leads
The view SHALL distinguish queued/active work, execution uncertainty, absent or changed sealed evidence and recorded verification outcomes. It SHALL validate existing closed native evidence before displaying an outcome as a sealed observation and SHALL report historical applicability separately. It SHALL retain the exact execution reference without manufacturing a product diagnosis, business acceptance or release authorization.

#### Scenario: Failed observation with stale source or report
- **WHEN** a sealed failed observation exists but its profile, policy, source or report is changed or unavailable
- **THEN** the view retains its historical reference and reports the applicability limitation without authorizing repair

#### Scenario: Execution is uncertain
- **WHEN** the latest selected task has an unknown execution or cleanup outcome
- **THEN** the view requires inspection and preserves its execution protection and original outcome

### Requirement: Discovery cannot execute work
The query SHALL write only its transport receipt and answer. It SHALL NOT start models or verifiers, publish source events, enqueue tasks, dispatch controls, alter history or guards, or replay work. Duplicate events SHALL queue at most one durable answer, including across gateway restart. A fresh authenticated owner task through existing admission SHALL remain necessary for subsequent work.

#### Scenario: Duplicate view across restart
- **WHEN** the same real owner message is delivered repeatedly or after restart
- **THEN** at most one durable answer is queued and execution, verification and source state remain unchanged
