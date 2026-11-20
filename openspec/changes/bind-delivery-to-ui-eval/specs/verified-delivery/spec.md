## ADDED Requirements

### Requirement: Delivery waits can bind a retained Web verification report

The enrolled private-chat owner with the required approval role SHALL be able to register a passing, sealed Web verification with a matching clean source commit and unchanged reports using `/delivery-wait <execution>`. The gateway SHALL derive the evidence reference from the recorded Git commit and report hashes. Queries SHALL display the evidence and its current applicability without launching a verifier or model.

#### Scenario: Register and inspect the original report

- **WHEN** the owner registers an eligible verification and later views its checkpoint
- **THEN** it displays the original validation run, source commit and evidence reference
- **AND** the existing checkpoint survives restart without creating a further task

### Requirement: Delivery confirmation and startup recheck the bound evidence

An exact confirmation with a new task SHALL admit at most one ordinary continuation in the original verified conversation. The gateway SHALL reject stale evidence without consuming the checkpoint. The Worker SHALL recheck the bound source and reports before launching and settle a prelaunch refusal without issuing a native turn. The checkpoint records the already-admitted request if this later check refuses launch. These actions SHALL NOT declare publication eligibility or authority.

#### Scenario: A report changes before confirmation or launch

- **WHEN** an original report's hash or its source binding no longer matches
- **THEN** confirmation is refused before admission, or the admitted continuation stops before native launch
- **AND** the original verification result remains available as history
