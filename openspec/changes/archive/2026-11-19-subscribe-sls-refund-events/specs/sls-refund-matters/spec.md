## ADDED Requirements

### Requirement: Scope-bound durable refund subscription

When a dedicated SMQ source is configured, the gateway SHALL receive only matching SLS Firing notifications into the existing incident observer. It SHALL persist the notification and pending observation before acknowledging delivery and SHALL resume pending observations after a restart. Invalid or conflicting events SHALL create no execution or incident.

#### Scenario: Delivery is retried after a failed acknowledgment

- **WHEN** the same scoped CloudEvent returns with a different receipt handle
- **THEN** the gateway retains one notification and reuses its incident
- **AND** it acknowledges using the new receipt handle

#### Scenario: Queue is idle

- **WHEN** subscription mode has no pending notification or due observation
- **THEN** the gateway waits on the queue without querying the SLS evaluation history

#### Scenario: Offline delivery

- **WHEN** the gateway receives a matching firing retained by the queue after downtime
- **THEN** it records the original trigger time and observes current evidence with the existing follow-up budget
- **AND** it preserves existing observation and recovery bounds

#### Scenario: Notification arrives during quiesce

- **WHEN** maintenance starts before a receive response returns
- **THEN** the gateway retains no new notification and acknowledges no new receipt during the pause

#### Scenario: Catch-up delays the first subscription sample

- **WHEN** unread history must be caught up for an incident without any samples
- **THEN** the first completed catch-up through the pending firing starts the observation budget
- **AND** prior recorded samples retain their deadlines

#### Scenario: A closure evaluation arrives late

- **WHEN** a subscription observation confirms recovery
- **THEN** the observer retains one bounded overlap recheck of the closure window across restart
- **AND** a conflicting late evaluation returns the original incident to human handoff

#### Scenario: The previous observer opens the retained ledger

- **WHEN** the ledger has been opened by the current observer and is opened by the previous observer
- **THEN** the previous observer can read the stored source, cursor, evaluation and incident identities

#### Scenario: Subscription is disabled with unread history

- **WHEN** a scheduled observer starts after subscription mode retained an unread notification
- **THEN** the scheduled observer starts from the saved SLS cursor
- **AND** the subscription idle floor cannot discard unread history

#### Scenario: A queued firing invalidates a previous closure

- **WHEN** a queued firing returns a resolved incident to human handoff
- **THEN** the observer retains unread history to distinguish the next firing from that incident
