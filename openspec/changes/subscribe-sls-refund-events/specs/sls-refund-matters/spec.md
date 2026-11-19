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
