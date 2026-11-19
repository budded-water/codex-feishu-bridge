## ADDED Requirements

### Requirement: Bounded managed observation

The managed pilot SHALL poll only the configured fixed read-only refund source when explicitly opted in and outside maintenance. It SHALL serialize cycles, retain the source cursor and settle in-flight work before database shutdown.

#### Scenario: Observation source unavailable

- **WHEN** the scoped evaluation query fails
- **THEN** the pilot continues ordinary Feishu service and the next interval retries from retained state

#### Scenario: Maintenance begins during a read

- **WHEN** maintenance starts during a poll
- **THEN** the completed read is retained as observer evidence and no new query or card projection starts during the pause

### Requirement: Durable owner-private incident matter

The gateway SHALL associate each incident with one scoped matter and use durable transport identity for each projected milestone. It SHALL leave active conversational focus and ordinary implicit routing independent of machine observations.

#### Scenario: Unverified private destination

- **WHEN** the configured chat has yet to deliver a verified private message from the bound owner
- **THEN** no incident card is queued for it

#### Scenario: A separate firing after human handoff

- **WHEN** the accepted evaluation history contains an inactive result, including one read after its later firing, that separates a later firing from an earlier incident that already needs attention
- **THEN** the later firing starts a new observation budget and matter
- **AND** the earlier handoff disposition is preserved

#### Scenario: Restart after a transport commit

- **WHEN** the gateway stops after enqueueing a card and before acknowledging observer projection
- **THEN** the next cycle reuses the original delivery and matter without duplication

#### Scenario: Confirmed owner reply

- **WHEN** the enrolled owner replies to a confirmed incident card without conflicting explicit targets
- **THEN** the request uses that matter and carries the historical observation as reference
- **AND** a conflicting explicit target requires the existing owner choice

#### Scenario: Visible card without delivery confirmation

- **WHEN** a new quote has no confirmed target and an alert card in the same conversation has no delivery confirmation
- **THEN** the gateway asks for a fresh plain request and leaves active task controls unchanged

#### Scenario: No owner message

- **WHEN** an alert opens, closes or needs attention
- **THEN** observation and delivery create no admitted request, AutoLoop run, Codex turn or production write
