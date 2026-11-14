## ADDED Requirements

### Requirement: Consistent English command dispatch

The core bridge, P1 gateway, native owner and probe SHALL recognize the canonical English tokens for their supported commands. Help, previews, developer instructions and current guides SHALL advertise the same syntax. Detailed status SHALL use `/status details`. Free-form bodies SHALL retain their existing newline and indentation semantics.

#### Scenario: English live controls

- **WHEN** an authorized actor sends a supported English steering, approval or answer command
- **THEN** it SHALL reach the same bound native request/turn under existing policy

### Requirement: Retired slash syntax cannot execute

Retired Chinese slash commands SHALL NOT start model work or decide requests. The admitted sender SHALL receive English-command help or a pointer to it. Ordinary Chinese natural controls SHALL preserve their existing semantics without granting approval or maintenance authority.

#### Scenario: Retired approval command

- **WHEN** an actor sends a retired Chinese approval spelling
- **THEN** no native approval decision SHALL be sent

### Requirement: Local pilot help

The P1 gateway SHALL answer `/help` locally for its admitted owner, including while paused. It SHALL advertise only supported P1 operations, preserve existing maintenance-role restrictions and deduplicate the incoming message.

#### Scenario: Help while idle or paused

- **WHEN** the enrolled owner requests help
- **THEN** no request, execution or model turn SHALL be created

### Requirement: Preserve evidence across syntax upgrades

Syntax upgrades SHALL preserve original stored message/control identities and historical evidence. Gateway/Worker activation SHALL drain existing work before switching artifacts. Historical live records SHALL NOT be relabeled as English-token acceptance.

#### Scenario: Previous campaign remains pending

- **WHEN** the English syntax artifact is activated
- **THEN** unexecuted queue live acceptance SHALL remain pending rather than being inferred from automated renamed-command tests
