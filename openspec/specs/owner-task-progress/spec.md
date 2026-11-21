# Owner task progress

## Purpose

Define scoped, truthful read-only browsing of existing owner tasks and durable confirmed-message refresh. Keep progress observations, native execution, verification, controls and publication authority separate. Deployment-specific evidence is recorded in [live acceptance](../../../docs/live-acceptance.md).

## Requirements

### Requirement: Scoped task browsing
The P1 gateway SHALL expose `/tasks [page]` and `/task <execution UUID>` only to the enrolled private maintenance owner. The default overview SHALL distinguish current counts from history and show at most ten outstanding tasks and three recent historical requests. Explicit page queries SHALL paginate the complete owner/chat/resource records ten at a time and retain exact historical references. Invalid or foreign requests SHALL NOT disclose task content or admit work.

#### Scenario: Ordinary and historical tasks
- **WHEN** the owner browses tasks or selects an exact owned execution
- **THEN** ordinary, verification and repair tasks remain distinguishable and pagination does not exclude older history

#### Scenario: Copied progress command becomes rich text
- **WHEN** a private user sends a title-free text-only rich post containing exactly one supported progress query
- **THEN** the ingress preserves its real actor/message identity and handles it as the same read-only query
- **AND** mixed content and other controls do not enter this read-only query route; unsupported owner posts receive a bounded format reply

### Requirement: Truthful read-only progress
Live progress SHALL come from the authenticated current owner and attempt without snapshot cleanup, model calls or writes to native/admission evidence. Missing liveness or evidence SHALL remain unverified. Native completion, verifier results, stop/withdrawal, uncertainty and delivery SHALL remain separate facts. Missing legacy timing SHALL NOT be invented.

#### Scenario: Owner loss or attempt transition
- **WHEN** the current owner cannot be authenticated or a repair attempt changes during a progress read
- **THEN** the view reports unverified current activity and preserves all execution guards and original outcomes

### Requirement: Durable safe refresh and controls
Detail cards SHALL retain redacted content and confirmed platform identity. A refresh SHALL match the authenticated actor, tenant, private chat, presentation, confirmed message and owned execution, and SHALL only queue a read-only update of that card. Query/callback receipt and answer SHALL commit atomically. Duplicate/restart/retry SHALL NOT admit or replay work. Persistent storage failure SHALL NOT poison gateway synchronization or closure.

#### Scenario: Duplicate or uncertain refresh
- **WHEN** a callback repeats or a send/patch acknowledgement is uncertain
- **THEN** retained receipt/delivery identities prevent additional queued updates for the same event and no replacement card or task is created

#### Scenario: Quoted stale detail card
- **WHEN** a user quotes an older task's detail card to stop or steer while a different task runs
- **THEN** original-task binding prevents that control from selecting the newer task; approval remains under the existing native-request policy
