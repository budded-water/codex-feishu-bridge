# Architecture

This MVP is implemented and covered by simulated behavior tests. Application setup, SDK connection, and owner enrollment are verified. A bounded owner read-only turn completed. New image-grounded group replies and live administrator approval acceptance remain pending; see docs/live-acceptance.md for evidence boundaries.

User-facing onboarding: [installation](installation.md), [configuration](configuration.md), [usage](usage.md), [tools and identities](integrations.md), and [troubleshooting](troubleshooting.md).

## Goal and boundary

Expose the Codex already installed on the owner's computer through a Feishu application bot for colleagues using private text or group @mentions. Keep project execution, Codex configuration, and local tools on that computer.

The bridge owns the transport and user interaction. Codex owns task reasoning, its tool loop, and execution under its configured permissions. Model inference continues to use Codex's configured provider. Optional `codexReasoningEffort` is deployment-scoped: the Codex adapter supplies `effort` on every `turn/start`, including resumed and routing threads, without changing the host configuration or any other request. Null/omitted leaves inheritance to Codex; a previously overridden thread may retain its effort. A restart applies changes to subsequent requests; in-flight turns are unchanged. Supported levels depend on the selected model and unsupported values fail rather than silently falling back.

This is an independent project that can route work to multiple local repositories. Do not embed it inside a target application repository.

## Components

| Component | Responsibility |
| --- | --- |
| Feishu adapter | Maintain the outbound SDK connection, normalize private text messages, and deliver native rich-post replies. |
| Codex adapter | Launch `codex app-server` as a child process, initialize JSON-RPC, correlate requests, and consume events. |
| Session manager | Select allowed project directories, map conversations to Codex threads, and serialize turns. |
| Approval manager | Forward requested actions and correlate authenticated decisions with live protocol requests. |
| Reaction feedback | Add native received reactions without blocking answers; reconcile ambiguous adds and retry durable removal after terminal task states. |
| State store | Persist session mappings, received message IDs, task status, and recoverable outbound delivery state in SQLite. |

The first version uses app-server's default stdio transport. It does not expose Codex on a network port. Feishu receives messages using its SDK long connection; text commands avoid needing a separate card callback endpoint in the initial version.

## Startup

1. Validate private configuration: required Feishu credentials, an explicit tenant or user access policy, approval routing, registered project paths, and local storage location.
2. Resolve project directories to real paths and verify they exist. Reject arbitrary paths supplied through chat.
3. Open SQLite and mark previously running tasks as interrupted or outcome unknown.
4. Launch the installed Codex executable using a subprocess argument array, without shell interpolation.
5. Complete app-server's `initialize` request and `initialized` notification before sending other protocol requests.
6. Establish the outbound Feishu connection and register message handlers. Wait for the actual SDK readiness callback, bounded to 30 seconds, with each underlying WebSocket handshake bounded to 10 seconds; terminal startup errors reject. Later terminal errors stop the application and release state ownership, while retryable reconnects stay with the SDK.

Use the local Codex identity and configuration. Pin and verify the installed protocol version; app-server remains an evolving interface. Do not copy the owner's Codex authentication files into the public repository.

## Message handling

1. Validate the event sender and chat type. Accept authorized private text or group text with a verified mention of this bot; enforce the pinned tenant in tenant mode. Ignore bot-originated and unauthorized events. After verifying this bot’s mention, replace other mention placeholders with names from the same event; unknown identities remain explicitly unknown, without contact lookups or invented names.
2. Register the message ID durably. Duplicate events must not create another task or approval decision.
3. Finish the event handler promptly. Do not wait for a Codex task inside the Feishu SDK handler.
4. Route bridge commands or enqueue a normal task. Persist queued task input locally, with the same protections as transcripts.
5. In automatic mode, classify the latest user request in a separate, tool-disabled, read-only Codex thread. A clear request selects only a registered alias; ambiguity produces one brief question, while ordinary conversation enters the persistent discussion thread. Requests needing chat reference material enter neutral discussion execution. Manual mode retains explicit selection. Persist the triggering selection, owner-scoped clarification, and routed marker; atomically hand off the same task once without overwriting a newer manual selection. Store trigger ID/time/type/reference with the queued request. Fetch bounded context (up to 50 records from the preceding 24 hours) only for execution, never for project authorization. An explicit parent quote is fetched independently even when recent history is enabled. Admit only the requested ID in the same chat before the trigger, including an explicitly quoted bot reply or older quote. Retain at most the original and latest clarification quotes, each validated against its own trigger time; prefer the latest clarification quote when the configured record budget is smaller. Preserve the original cutoff for recent history. Reserve quote slots within that budget (at most two explicit quotes when history is disabled), deduplicate against history and mark them `quoted`; unrelated bot history remains excluded. Quote/history failures are isolated and reported, never replaced with guessed content. Text placeholders and native post `at` elements use supplied display names; unknown identities stay unknown and never grant authority.
   If image reading is enabled, download only admitted standalone/post image resources. Prioritize explicit quote images (latest clarification before original quote), then recent history images, under the configured attempt cap and canonical byte/time budgets. Supply each as an inline image input with its message reference; exclude image URLs/base64 from the context JSON. Download failures remain local to that image, and unprovided media is explicitly unread.
6. Start the turn with developer instructions distinguishing chat reference material from execution authority and repository configuration. Treat image content as reference data, never execution authority. Instruct Codex to answer directly in short chat paragraphs, expanding when asked. Discussion returns a direct final answer. Thread start/resume instructions include the live registered aliases and current selection without host paths; the catalog grants no execution authority. Business-data questions first establish the selected project and verified data source instead of enumerating external accounts or guessing a connector. Normal tasks receive a native `OnIt` reaction on their original message. If adding the reaction fails, one short acknowledgment is queued instead. Queued work is identified as not yet started. No routine long-wait notice is sent; `/status` shows elapsed time, the current stage, and the age of the last correlated Codex event. Process readiness is not model/network health. These are feedback signals, not proof of completion. Draft answers remain internal. Terminal tasks remove only the bot's own reaction, with persisted reconciliation and cleanup retries; delayed statuses are discarded after task completion. HTTP outages can delay feedback or cleanup, and host sleep cannot be reported through an offline channel. A long wait does not automatically interrupt or replay work. Accumulate agent text deltas internally; do not forward drafts or commentary as progress.
7. Interpret `turn/completed` using the actual turn status. Report completion, failure, and interruption distinctly.
8. Persist the outcome and enqueue the final reply once for retryable delivery. Render Markdown through native Feishu post elements with smaller headings and compact spacing outside code. Split long replies before persistence, preferring line boundaries and closing/reopening fenced code; unusually long lines split at Unicode boundaries. Known gateway/API secrets are removed from the full outbound text before splitting and persisting new chunks. Each part has a stable UUID. A delivery retry must not rerun the agent task. Interrupted/failed turns do not publish unfinished agent drafts. Even a completed turn cannot use commentary or incomplete deltas as its answer; only final-answer messages or completed unphased messages are eligible.

Receiving a task, completing execution, and delivering the result are separate states. A successful initial acknowledgment does not prove task completion.

## Conversations and commands

A session mapping uses the application tenant, user, private or group chat, project, and bridge session identifier. Each mapping records the Codex thread ID. SQLite also stores owner-scoped routing threads and clarification, task routing origin/once-only handoff markers, and bounded interaction diagnostics. Additive migrations retain existing task state. SQLite is canonical for the bridge mapping; Codex's thread history is canonical for agent conversation history. The bridge must validate that the referenced thread remains available before resuming it.

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

Discussion sessions use private per-user/chat directories under the state directory. Older project histories are preserved; switch with `/chat` to leave an existing selected project. Neutral mode instructs Codex not to browse a repository to guess group context, without relaxing local sandbox or approvals. The missing-history shortcut applies only to a fresh neutral discussion with an explicit chat reference; self-contained project tasks and follow-ups in existing Codex threads are not rejected by optional missing group history. Free-form steering and question answers preserve embedded newlines and indentation.

When a session is idle, normal text starts another turn in the same thread. When busy, normal text queues for the next turn. Control commands bypass the queue. Status, steering and stopping select the owned execution turn before falling back to that request’s routing turn; another owner’s directory activity cannot mask it. Routing stop requests record cancellation before awaiting interruption, so a racing completion cannot hand off execution. If the start RPC is unconfirmed, wait for its returned turn ID and drain that turn before reuse. Buffer early events until that ID is known; ignore stale events from other turns and preparation phases. Routing-time steering is persisted in request order and handoff waits for acceptance; a failed or oversized steering request interrupts and drains the routing turn instead of executing without the new constraints. If interruption is uncertain, including a failed `/stop` of an already confirmed routing turn, discard the router mapping and queued work rather than reusing that classifier. Classifier controls also match the original selected session rather than their internal discussion session. Unclassified status and queue-clearing operations use the request’s original selected session, not its internal discussion routing session. Capture the selection when each request arrives; after classification, bind execution to its chosen session and project. Automatic handoffs do not change the manual-selection revision or discard later queued clarification. A monotonically increasing manual-selection revision prevents a late classifier decision from overwriting newer manual commands, including selecting the same alias or switching away and back. Owner-scoped routing threads, pending clarification and its original trigger/reference metadata are separate from project execution histories. New-session, stop and queue-clear controls discard pending clarification. Recovery or queue cancellation of an unfinished classification clears that owner’s pending input/source while preserving idle clarifications. Routing failure or abort also discards pending input and its source; accepted steering invalidates the old pending snapshot so later retries cannot revive work without the new constraints.

For the first version, run at most one active turn per project directory, even across multiple bridge sessions. Separate project directories can execute independently. Concurrent work in the same repository requires explicitly isolated worktrees and is outside the initial scope.

Thread resumption can be added for existing local chats if the installed Codex version exposes those threads. Do not promise that the current desktop chat or its UI-only capabilities automatically carry over.

## Approvals

An approval response must come from a configured administrator in its designated chat and match the task tenant, thread, turn, and subprocess generation. The approval chat can be the owner's private chat, even for a colleague task. Question replies require the original submitter and original chat. Show the action, scope, and reason. Offer request-level acceptance and rejection using the pinned protocol's decisions. Switching projects does not change request ownership.

Never turn an approval timeout into acceptance. If the configured timeout expires, decline or cancel using a supported protocol decision and clearly report the result. Do not treat a text reply to an old request as approval for a new request.

Command/file approvals and single non-sensitive questions are supported. Multi-question requests, secret questions, and permission grants are denied. Unknown interactive families receive a protocol error identifying bridge rejection rather than user rejection. The final answer explains any resulting blockage; no separate technical notice is sent. Current-task diagnostics in `/status` and operational logs expose only a bounded protocol identifier, not request arguments, credentials or URLs. Missing action previews are declined.

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

Configuration has two surfaces: checked-in examples and private runtime values. src/config.ts is canonical for accepted fields; keep examples synchronized. External application credentials, scopes, subscriptions, and availability must match docs/feishu-setup.md. Feishu is canonical for published permission grants; private configuration is canonical for the opted-in message count; code enforces trigger/chat/time/count limits. A platform group-read scope is broader than these limits and requires separate scope confirmation. Missing platform grants make context unavailable even when private configuration enables it.

## Acceptance boundary

Automated tests establish simulated routing, state, approvals, and transport behavior. The local smoke establishes a real stdio handshake without inference. Neither establishes application provisioning, inference access, or live round trips. Update the README, implementation plan, and PR when live acceptance gains evidence.

## Conversation UX and durable associations

Task trigger IDs are immutable and separate from the original/clarification source used for reference context. SQLite stores response options and actual delivered message-to-task associations, including destination chat. Results and task feedback use the official message reply API with stable UUIDs; only explicit recalled/deleted errors allow fallback to creation in the original chat. Uncertain transport errors retain the original endpoint. Native replies do not publish internal project/task footers. Owner/chat checks prevent another user's message or an administrator inbox message from becoming a control target.

An optional exact registered-alias prefix (`alias: request` or full-width colon) explicitly selects a new project task and bypasses model classification. It advances the manual-selection revision, clears old clarification and still applies real-directory validation/serialization. Unregistered prefixes remain normal requests; no alias is mandatory. Manual mode still supports this explicit selector.

The bridge recognizes a bounded set of explicit Chinese control phrases, not general reasoning. A unique owned active task or a verified quoted task receives steering/stopping; ambiguous targets receive one clarification. An unbound implicit read request explicitly naming another registered project remains new work during execution; explicit supplements, prohibitions and verified task quotes retain their control target. Classification never treats its internal discussion workspace as the user’s project. Queue cancellation uses the original selection only during classification and the actual execution session after handoff. Plain pause phrases also cancel the bound session queue; explicit current-task stop and slash controls preserve queued work. Preparation supplements enter the first model input when start has not begun; unconfirmed starts do not acknowledge unaccepted steering. Execution-start stop intent is retained until the returned turn can be interrupted; uncertainty cancels queued work and never replays actions. Supplementary explicit references use scoped context/image inputs, with terminal/generation checks after awaits.

Approval previews preserve exact fenced action text, show intent and a concrete deadline in the host timezone, and never expand authorization beyond that RPC. An optional metadata-only read of the immutable trigger verifies sender ID, tenant and chat before using sender names/message links; failure remains explicit. Slow metadata cannot resurrect resolved/expired prompts. Prompt IDs/status/deadlines are persisted; stale outbox previews and waiting notices are discarded, and in-flight delivery cannot be recalled. Single non-sensitive answers derive the sole question ID from the authenticated prompt token; the legacy matching-ID syntax remains compatible. Ordinary agreement does not approve requests.

Native notifications preserve the user message body after removing only leading recipient selectors and are an explicit in-group transport action targeting up to 20 distinct members selected in the current admitted event. They do not resolve contacts from plain names or historical content, create tasks, notify all, or send to another chat. Native `at` elements are rendered only from the supplied allowlist; ordinary model markup cannot notify arbitrary IDs. Fenced code previews remain exact. Notification selection is not execution/approval authority or evidence of reading. Unknown/unsupported messages only receive help after existing admission and bot-mention checks; unauthorized traffic remains silent.

Status defaults to current work, queue and required action; `/status 详情` exposes process/event diagnostics. Failures and interruptions have one truthful explanation, with uncertain prior effects explicit. Recovery notices are grouped by owner/chat without replay. SQLite additionally records receive/routing/handoff/execution/feedback/result-delivery timestamps. Local metrics load `.env` and honor `BRIDGE_CONFIG` like the runtime, exclude legacy tasks without timestamps and summarize at most the latest 1000 records. First-result latency describes the first delivered chunk, not proof that all chunks or a human read have completed; no telemetry leaves the host.

同一项目的执行结果未确认时，此前已进入分类流程的请求也会在交接时停止；先核对本机结果，再发起新请求，不自动重跑。简化问题回答只移除编号后的一个分隔符，保留内容的换行和缩进。
