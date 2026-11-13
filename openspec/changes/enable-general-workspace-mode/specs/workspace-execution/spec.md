## ADDED Requirements

### Requirement: Explicit general workspace mode
The bridge SHALL accept `projectRouting: "workspace"` with one canonical configured execution directory. It SHALL retain automatic and manual routing behavior for their existing configurations.

#### Scenario: Aliases designate a neutral workspace
- **WHEN** all configured aliases resolve to one canonical directory and workspace mode is selected
- **THEN** configuration validation SHALL accept the workspace
- **AND** distinct canonical directories SHALL require a different routing mode

### Requirement: Direct general task execution
Workspace mode SHALL execute an authorized ordinary request in the owner's workspace conversation with the configured default cwd. Native Codex SHALL resolve any business target from the current request and relevant conversation using its native permissions and approval policy.

#### Scenario: A user has no selected business project
- **WHEN** the verified owner submits a general task
- **THEN** the bridge SHALL select its neutral workspace and start native execution directly
- **AND** native instructions SHALL describe current-request target resolution and native permission authority

#### Scenario: The owner continues with another task target
- **WHEN** a subsequent request identifies another repository or a general task
- **THEN** it SHALL continue the owner-scoped workspace conversation
- **AND** all such requests SHALL share the workspace execution guard and serialized lane

#### Scenario: An assigned execution starts or resumes
- **WHEN** the P1 runner creates its native Bridge in workspace mode
- **THEN** it SHALL preserve that mode in the native instructions and status
- **AND** live controls, approval ownership and uncertain outcomes SHALL follow their existing contracts

### Requirement: Workspace status and guidance
Workspace status and guidance SHALL identify the general workspace and tell the user to state the task and its target.

#### Scenario: The user asks to select a project
- **WHEN** workspace mode receives a project-selection command
- **THEN** the bridge SHALL explain current-request target selection
- **AND** its conversation SHALL remain in the configured workspace
