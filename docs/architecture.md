# Architecture

This MVP is implemented and covered by simulated behavior tests. Application setup, SDK connection, and owner enrollment are verified. A bounded owner read-only turn completed. Context-grounded discussion and live administrator approval acceptance remain pending; see docs/live-acceptance.md for evidence boundaries.

## Goal and boundary

Expose the Codex already installed on the owner's computer through a Feishu application bot for colleagues using private text or group @mentions. Keep project execution, Codex configuration, and local tools on that computer.

The bridge owns the transport and user interaction. Codex owns task reasoning, its tool loop, and execution under its configured permissions. Model inference continues to use Codex's configured provider.

This is an independent project that can route work to multiple local repositories. Do not embed it inside a target application repository.

## Components

| Component | Responsibility |
| --- | --- |
| Feishu adapter | Maintain the outbound SDK connection, normalize private text messages, and deliver replies. |
| Codex adapter | Launch `codex app-server` as a child process, initialize JSON-RPC, correlate requests, and consume events. |
| Session manager | Select allowed project directories, map conversations to Codex threads, and serialize turns. |
| Approval manager | Forward requested actions and correlate authenticated decisions with live protocol requests. |
| State store | Persist session mappings, received message IDs, task status, and recoverable outbound delivery state in SQLite. |

The first version uses app-server's default stdio transport. It does not expose Codex on a network port. Feishu receives messages using its SDK long connection; text commands avoid needing a separate card callback endpoint in the initial version.

## Startup

1. Validate private configuration: required Feishu credentials, an explicit tenant or user access policy, approval routing, registered project paths, and local storage location.
2. Resolve project directories to real paths and verify they exist. Reject arbitrary paths supplied through chat.
3. Open SQLite and mark previously running tasks as interrupted or outcome unknown.
4. Launch the installed Codex executable using a subprocess argument array, without shell interpolation.
5. Complete app-server's `initialize` request and `initialized` notification before sending other protocol requests.
6. Establish the outbound Feishu connection and register message handlers.

Use the local Codex identity and configuration. Pin and verify the installed protocol version; app-server remains an evolving interface. Do not copy the owner's Codex authentication files into the public repository.

## Message handling

1. Validate the event sender and chat type. Accept authorized private text or group text with a verified mention of this bot; enforce the pinned tenant in tenant mode. Ignore bot-originated and unauthorized events.
2. Register the message ID durably. Duplicate events must not create another task or approval decision.
3. Finish the event handler promptly. Do not wait for a Codex task inside the Feishu SDK handler.
4. Route bridge commands or enqueue a normal task. Persist queued task input locally, with the same protections as transcripts.
5. Default to a neutral discussion session, or use a project the user explicitly selected. Store trigger ID/time/type/reference with the queued request. After authorization, fetch only the configured bounded context in the originating chat before creating or restoring a Codex thread.
6. Start the turn with developer instructions distinguishing chat reference material from execution authority and repository configuration. Discussion returns a direct final answer; explicitly selected project execution can forward meaningful progress. Merge text deltas into rate-limited replies; do not publish raw protocol events, secrets, or complete shell logs by default.
7. Interpret `turn/completed` using the actual turn status. Report completion, failure, and interruption distinctly.
8. Persist the outcome and enqueue the final reply for retryable delivery. A delivery retry must not rerun the agent task.

Receiving a task, completing execution, and delivering the result are separate states. A successful initial acknowledgment does not prove task completion.

## Conversations and commands

A session mapping uses the application tenant, user, private or group chat, project, and bridge session identifier. Each mapping records the Codex thread ID. SQLite is canonical for the bridge mapping; Codex's thread history is canonical for agent conversation history. The bridge must validate that the referenced thread remains available before resuming it.

These commands belong to the bridge, not the Codex CLI:

| Command | Behavior |
| --- | --- |
| `/project <alias>` | Explicitly select a registered project and execution session. |
| `/chat` | Select a neutral per-user/chat discussion workspace. |
| `/new` | Create a new session when the selected session has no pending work. |
| `/status` | Display active task, queued work, and pending approvals. |
| `/补充 <text>` | Steer the selected active turn through `turn/steer`; reject if none is active. |
| `/stop` | Interrupt the selected active turn through `turn/interrupt`. |
| `/clear` | Cancel the selected session's queued tasks. |
| `/批准 <id>` | Configured administrators accept a live approval in its designated chat. |
| `/拒绝 <id>` | Configured administrators decline an approval; the submitter can decline their own question. |
| `/回答 <id> <question-id> <answer>` | Answer a single non-sensitive question. |

Discussion sessions use private per-user/chat directories under the state directory. Older project histories are preserved; switch with `/chat` to leave an existing selected project. Neutral mode instructs Codex not to browse a repository to guess group context, without relaxing local sandbox or approvals.

When a session is idle, normal text starts another turn in the same thread. When busy, normal text queues for the next turn. Control commands bypass the queue. Bind queued tasks to their original session and project so a later project switch cannot reroute them.

For the first version, run at most one active turn per project directory, even across multiple bridge sessions. Separate project directories can execute independently. Concurrent work in the same repository requires explicitly isolated worktrees and is outside the initial scope.

Thread resumption can be added for existing local chats if the installed Codex version exposes those threads. Do not promise that the current desktop chat or its UI-only capabilities automatically carry over.

## Approvals

An approval response must come from a configured administrator in its designated chat and match the task tenant, thread, turn, and subprocess generation. The approval chat can be the owner's private chat, even for a colleague task. Question replies require the original submitter and original chat. Show the action, scope, and reason. Offer request-level acceptance and rejection using the pinned protocol's decisions. Switching projects does not change request ownership.

Never turn an approval timeout into acceptance. If the configured timeout expires, decline or cancel using a supported protocol decision and clearly report the result. Do not treat a text reply to an old request as approval for a new request.

Command/file approvals and single non-sensitive questions are supported. Multi-question requests, secret questions, and permission grants are denied. Unknown interactive families receive a protocol error and user-facing explanation. Missing action previews are declined.

Persist an approval summary and the deciding actor for audit, but its live JSON-RPC request belongs to the current subprocess. On subprocess exit or turn interruption, invalidate affected approvals. A recovered session may generate fresh requests with fresh identifiers.

Sessions isolate conversation history, not filesystem or credential access. All admitted colleagues share the registered projects and the host Codex identity and tools. Group task output is sent to the originating group.

Retain Codex's sandbox and approval settings. The bridge must not enable unrestricted execution just to make unattended tasks succeed.

## Failures and recovery

| Failure | Recovery |
| --- | --- |
| Feishu reconnect or duplicate event | Reconnect using SDK behavior and deduplicate against persisted message IDs. |
| Result delivery failure | Retry the stored outbound reply; retain the completed task outcome. |
| Codex subprocess exit | Reject outstanding RPC promises, invalidate approvals, and mark active tasks interrupted or outcome unknown. Restart with bounded backoff. |
| Bridge restart | Restore mappings and pending delivery records. Mark interrupted tasks; ask the user to inspect or explicitly continue before replaying actions. |
| Missing Codex thread | Explain that restoration failed and offer a new session; do not silently pretend history was restored. |
| Host sleep or network loss | New message handling is unavailable. Running work may finish and queue its result. Do not guarantee offline replay. |

Write-capable tasks must not be automatically replayed after an uncertain outcome. Reconciliation checks the project or external service's live state before continuing.

## Public repository and private runtime state

Publish source, placeholder examples, architecture, and tests. Keep credentials, actual user IDs, local project paths, database files, transcripts, and logs ignored and locally private. Runtime state should use restrictive filesystem permissions.

Configuration has two surfaces: checked-in examples and private runtime values. src/config.ts is canonical for accepted fields; keep examples synchronized. External application credentials, scopes, subscriptions, and availability must match docs/feishu-setup.md.

## Acceptance boundary

Automated tests establish simulated routing, state, approvals, and transport behavior. The local smoke establishes a real stdio handshake without inference. Neither establishes application provisioning, inference access, or live round trips. Update the README, implementation plan, and PR when live acceptance gains evidence.
