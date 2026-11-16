# Bounded verification repair

## Purpose

Define explicit owner-authorized repair goals that retain the native Codex conversation, limit additional work, preserve independent attempt evidence and controls, and require inspected reconciliation rather than replay after uncertainty. Verification, review, delivery and publication remain separate facts. The delivered scope starts with registered Web functional assertion failures; deployment-specific evidence is recorded in [live acceptance](../../../docs/live-acceptance.md).

## Requirements

### Requirement: Explicit bounded repair admission

The system SHALL admit repair only from an explicit new-task owner opt-in and trusted repair-enabled profile. It SHALL snapshot original actor/chat/message and project/profile/engine/policy bindings, at most one additional native turn, at most two verifications and finite work/cleanup deadlines covered by the actual Worker budget. Ordinary tasks and `/verify` SHALL retain their contracts.

#### Scenario: Existing verification fails

- **WHEN** an ordinary `/verify` task returns candidate failure
- **THEN** the system SHALL report it without an automatic repair turn

#### Scenario: Deadline or credit exhausted

- **WHEN** no turn credit or work budget remains
- **THEN** no later work SHALL start and actual outcome/cleanup disposition SHALL remain recorded

### Requirement: Evidence-qualified continuation

The first slice SHALL qualify only registered deterministic Web product functional assertion failures with valid task/source/policy/engine-bound evidence and confirmed cleanup. Required non-scenario stages SHALL pass. Mixed, review, stale, infrastructure and unsupported failures SHALL NOT authorize repair. Report content SHALL be reference data, not policy.

#### Scenario: Aggregate fail contains another failure class

- **WHEN** a result includes an infrastructure fault, required human review or unsupported failed gate
- **THEN** no repair SHALL start and the actual failed/incomplete disposition SHALL remain visible

#### Scenario: Source or policy changes after capture

- **WHEN** source changes outside authorized native work or trusted bindings drift before repair dispatch
- **THEN** continuation SHALL be refused rather than accepting a weakened or stale floor

### Requirement: Single assignment and immutable attempts

The system SHALL retain one assignment/resource guard with unique ordered attempt identities, launch intents, journals and sealed checkpoints. It SHALL atomically consume credits before possible dispatch and bind ordered evidence in a goal manifest without changing historical single-turn interpretation. Native continuation SHALL resume only the verified owner/project conversation under admitted goal authority, without impersonating platform messages or approvals.

#### Scenario: Eligible first attempt

- **WHEN** attempt 1 finishes with eligible evidence and available credit
- **THEN** attempt 2 SHALL have a distinct generation/turn/journal, verified same conversation and real original Feishu reply identity
- **AND** attempt 1 evidence SHALL remain unchanged

#### Scenario: Duplicate or missing acknowledgement

- **WHEN** dispatch repeats or its acknowledgement is missing
- **THEN** committed intent SHALL be reconciled without another child or new credit

### Requirement: Goal stop and current-attempt controls

Accepted stop SHALL persist at goal scope and prohibit later native/verifier launches. Controls SHALL require current attempt/generation/thread/turn and existing actor/request authorization. Only status/stop SHALL be supported during verification/transition gaps. Uncertain dispatch SHALL remain lookup-only.

#### Scenario: Prior approval arrives during repair

- **WHEN** an attempt-1 control arrives after attempt 2 becomes current
- **THEN** it SHALL NOT control or authorize attempt 2

#### Scenario: Stop races with repair

- **WHEN** stop is accepted before a pending repair/verifier obtains launch authority
- **THEN** launch SHALL be prohibited despite earlier eligible evidence

### Requirement: Truthful settlement and inspected uncertainty

The system SHALL preserve separate native/verification/review/delivery/publication facts and immutable history. Final relevant answer/goal summary SHALL use stable transport identities. Owner loss and uncertain launch/effect/cleanup SHALL NOT authorize replay. New goal uncertainty SHALL require compatible inspected maintenance rather than native-only Feishu recovery.

#### Scenario: Repair finishes but verification fails

- **WHEN** verification 2 fails after completed native repair
- **THEN** the goal SHALL report failed declared scope and exhausted repair credit rather than completion inferred from prose

#### Scenario: Owner disappears between attempts

- **WHEN** an unfinished goal loses its owner or Worker
- **THEN** startup SHALL inspect committed evidence without starting another attempt/verifier
- **AND** possible launch or incomplete cleanup SHALL retain protection until supported inspected reconciliation

#### Scenario: Delivery retry or historical lookup

- **WHEN** a final acknowledgement is lost or history is queried
- **THEN** persisted evidence/transport identities SHALL be reused without new native or verifier work
