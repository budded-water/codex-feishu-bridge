## Execution model

`projectRouting: "workspace"` declares a general workspace. All configured aliases must resolve to the same canonical directory, which supplies the default cwd and execution resource. The existing projects representation records that runtime workspace. Business repositories are identified in the current task and verified by native Codex. General tasks enter one owner/chat conversation directly, with one native execution per request.

The workspace guard serializes requests mentioning different repositories as well as other general tasks. Uncertain work holds that same resource. The current single-worker deployment gains general task targeting through one serialized lane. Native sandbox and approval policies determine actual filesystem, command and tool access. Chat references supply context, while the verified current user's request supplies task authority.

## Entry and continuation

The shared Bridge selects the configured workspace for an owner without a workspace session. Workspace requests skip the tool-disabled project classifier. Native start and resume both receive general-workspace instructions. Project commands explain how to state the task target in this mode, and status identifies the general workspace. Automatic and manual workflows retain their existing behavior.

The P1 runner retains the workspace mode when constructing its per-execution Bridge. Its request/conversation identity, default cwd, source assignment and canonical guard continue to use the configured workspace. Conversation references and controls follow the existing execution-ID contracts.

## Rollout

Keep the currently deployed source captured during verification. After checks and review pass, stage a versioned artifact, drain and stop the M6 gateway and worker, update their artifact references and workspace mode, then restart under the existing managed ownership. Preserve a frozen configuration snapshot for the original handoff plan and verify that its parsed plan identity still matches the retained backup before changing the active routing mode. Verify owner-chat status and native continuation. Record the effective mode and remaining native interactive acceptance in the private manifest and public acceptance summary.
