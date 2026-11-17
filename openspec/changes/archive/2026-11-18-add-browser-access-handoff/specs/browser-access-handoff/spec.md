## ADDED Requirements

### Requirement: Structured browser access observations

The bridge SHALL record only supported Browser Use saved-denial metadata as an immutable task/generation/item observation with canonical HTTP(S) origin and observed time. It SHALL reject malformed or credential-bearing origins and SHALL NOT treat model prose or another server as policy evidence. Raw tool arguments, paths and query strings SHALL NOT appear in the observation. Historical observations SHALL NOT claim current policy, business failure or delivery status.

#### Scenario: Browser denial with native approval

- **WHEN** a supported browser tool returns `persisted_user_denied` while native Auto-review passes
- **THEN** the browser observation SHALL remain separate from native review and completion
- **AND** duplicate events SHALL preserve one original observation

#### Scenario: Legacy journal

- **WHEN** a sealed journal predates browser observations
- **THEN** reading it SHALL report unavailable coverage without creating tables or modifying its bytes

### Requirement: Actionable read-only handoff

Enrolled owner-private views SHALL expose bounded observed origins and accurate provider-owned remediation, with no approval affordance that implies a browser grant. Post-settlement notice receipt and outbox SHALL commit atomically under the source execution identity. Views, guidance, duplicates and delivery retries SHALL NOT invoke models, change policy or admit continuations.

#### Scenario: Verbal allow

- **WHEN** the owner sends a narrowly recognized browser-access allow phrase
- **THEN** the bridge SHALL explain actual settings/continuation requirements without reporting a policy change or starting a model task

### Requirement: Explicit linked continuation

Only an exact owner-private `/browser-retry <execution> local-change-confirmed` SHALL request one fresh ordinary continuation for an owned completed source with verified sealed observations and unchanged latest conversation. Admission SHALL atomically recheck checkpoint, actor, conversation and resource protection, consume source identity once, and retain the link. Verification/repair and uncertain/stale sources SHALL NOT use this continuation.

#### Scenario: Duplicate or uncertain receipt

- **WHEN** the same source continuation is requested again after lost delivery or restart
- **THEN** lookup SHALL return its existing request without creating another task or resending execution

#### Scenario: Source changes before execution

- **WHEN** the sealed source changes after admission
- **THEN** startup SHALL refuse before launching native work rather than assuming permission or replaying the source

### Requirement: Browser authority and honest delivery

Continuation SHALL retain native/browser policies, use no Guardian override or browser-policy edit, and check access through supported Browser Use. It SHALL inspect prior effects and continue only unfinished authorized work. A renewed denial SHALL remain a blocker; attestation or successful admission SHALL NOT prove permission granted, message sent or business objective achieved. Fresh executors SHALL establish execution-local browser handles rather than assuming prior runtime variables persist.

#### Scenario: Setting is still denied

- **WHEN** owner-attested continuation encounters another saved browser denial
- **THEN** no permission grant or delivery success SHALL be inferred and no automatic replay SHALL follow
