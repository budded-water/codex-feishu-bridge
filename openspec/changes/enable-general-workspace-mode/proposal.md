## Why

The M6 owner wants one Feishu agent that accepts general requests and works with repositories identified in each task. The current P1 entry assigns every request to a fixed pilot project, and its native instructions describe that directory as an already selected business project. A default execution directory is needed for the native process, while the user needs to choose task targets through ordinary requests.

## What Changes

- Add an explicit `projectRouting: "workspace"` mode using one canonical neutral workspace.
- Admit ordinary tasks directly into its owner-scoped conversation and serialized execution lane.
- Let native Codex resolve task targets from the verified current request and relevant conversation, applying its existing permissions and approval policy.
- Describe the mode consistently in native instructions, status and operator documentation.
- Preserve the automatic and manual project workflows and their registered-project contracts.

## Capabilities

- workspace-execution covers neutral execution, target selection and native policy ownership.

## Impact and Acceptance

The change affects configuration validation, the shared Bridge entry and instructions, assigned native execution and pilot status. Tests must cover direct admission, continuation, serialization and native propagation. The M6 rollout uses the enrolled owner and existing Zhe! Bot after current work drains. Existing credentials, project state and publication policies are managed through their respective native boundaries.
