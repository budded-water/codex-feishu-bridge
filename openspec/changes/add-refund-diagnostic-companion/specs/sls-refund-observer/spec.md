## ADDED Requirements

### Requirement: Bounded diagnosis when a final backlog batch crosses the cutoff

When a final observation has a single fresh valid channel record from a known batch, the observer SHALL be able to make one bounded, read-only query after the exclusive cutoff. It SHALL retain the result as diagnostic evidence, separate from the original recovery assessment.

#### Scenario: The other channel is found beyond the cutoff

- **WHEN** the bounded read contains the missing channel for the same run
- **THEN** the observation records the normalized companion row separately and keeps the original assessment and cutoff
- **AND** the authenticated owner-private notice identifies the row as supplemental diagnosis

#### Scenario: The companion is unconfirmed

- **WHEN** the bounded read is incomplete, contains inconsistent evidence, or only returns unrelated runs
- **THEN** the observation distinguishes an unavailable read from a complete read without a match
- **AND** no evidence from another batch can complete the original observation

#### Scenario: Maintenance begins before the supplement

- **WHEN** maintenance begins after the original diagnostic response and before the supplemental read
- **THEN** no additional source request begins and the original observation is retained
