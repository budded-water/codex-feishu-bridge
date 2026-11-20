## ADDED Requirements

### Requirement: Delivery waits can bind a retained Web verification report

The enrolled private-chat owner with the required approval role SHALL be able to
register a passing, sealed Web verification with unchanged reports and a
matching source commit observed clean before and after the run, including Git
submodules. The gateway SHALL derive the reference from the source commit and
report hashes. Queries SHALL display evidence and applicability without
launching a verifier or model.

#### Scenario: Register and inspect the original report

- **WHEN** the owner registers an eligible verification and later views its checkpoint
- **THEN** it displays the original validation run, source commit and evidence reference
- **AND** the existing checkpoint survives restart without creating a further task

### Requirement: Delivery confirmation and startup recheck the bound evidence

Exact confirmation SHALL admit at most one ordinary continuation in the original
conversation. The gateway SHALL reject stale evidence without consuming the
checkpoint. The Worker SHALL recheck source and reports before startup and
before native turn submission. A launch refusal SHALL produce a durable notice
without a submitted turn. These actions SHALL NOT confer publication authority.

#### Scenario: A report changes before confirmation or launch

- **WHEN** an original report's hash or its source binding no longer matches
- **THEN** confirmation is refused before admission, or the admitted continuation stops before native launch
- **AND** the original verification result remains available as history
- **AND** when already admitted, the checkpoint retains the attempted continuation
