# Live acceptance evidence

This record describes the owner installation. It does not imply that a new installation is already configured. Keep credentials, account identifiers, project paths, and chat transcripts in private local configuration/state only.

## Observed

- A dedicated self-built bot application is enabled and published.
- The developer console shows private-message receive and bot-send scopes as added, and the message-received event is subscribed.
- The official SDK connected; the developer console verified the persistent connection as connected.
- Challenge enrollment received the owner's matching private message and exited successfully.
- The enrolled owner is the designated local approval administrator; team mode pins the owner application tenant and admits its colleagues. Approvals are routed to the owner private bot chat.
- Local configuration and the installed Codex protocol version passed `doctor`.
- The bridge initialized local Codex and connected to Feishu in foreground mode.
- Team routing and approval permissions passed the automated behavior suite, including legacy audit migration.
- The official bot-info API returned a valid application bot identity, and the published version API confirmed the group-mention scope.
- A local launchd definition passed `plutil -lint`; it has not been installed or activated.

## Enrollment redelivery regression

The live setup exposed a replay boundary: Feishu redelivered the enrollment message after the identification client disconnected, and the initial task router treated it as ordinary task text. The exact `pair <UUID>` syntax is now reserved and ignored before session selection or task enqueueing. A behavioral regression covers duplicate/redelivered challenges before and during a normal task, while allowing ordinary discussion of enrollment syntax.

A completed turn caused by that redelivery is not counted as the intended bounded task acceptance.

## Discussion-context regression

An owner group question referring to earlier discussion reached Codex with only the @mention text. The default project selection exposed repository guidance, which the answer incorrectly treated as the discussion. The owner supplied a screenshot and reported the irrelevant answer; the specific local task input and final answer confirmed the failure. A separate intended read-only project turn completed, so inference access alone was not the missing capability.

The fix defaults new conversations to neutral discussion, requires explicit project selection, suppresses discussion execution-state replies, and distinguishes group reference material from instructions and local repository rules. Recent context is opt-in and bounded to at most 20 prior messages from the preceding 24 hours. Quoted-message-only context is supported. Missing history and unread media are stated explicitly. Behavioral tests use fictional context; the owner has now authorized reading at most 20 records from the preceding 24 hours in the triggering group. Private runtime configuration is set to 20. A count-only scoped API verification returned `230027` (missing permissions); actual history retrieval remains unavailable until the necessary published scopes are enabled.

## Reply-format regression

The owner screenshot showed raw Markdown emphasis in plain-text replies and duplicated answer content in a project progress message and final message. The transport now sends native rich posts, compresses excess spacing and heading size outside code, and splits long replies with Unicode and fenced-code handling. Project drafts/commentary are accumulated internally instead of sent as progress. A successful project reply has a small identifying footer; interruption/failure does not expose unfinished text as a result. Tests validate payloads and event sequences without sending messages. Actual Feishu client rendering still needs a new live reply.

## Pending

- Native rich reply rendering in the actual Feishu client, including emphasis, links, lists, and fenced code.

- Published colleague availability and a colleague-account @mention/status round trip. Owner group membership and @mention delivery are observed; they do not establish every colleague's access.
- Relevant group discussion using quoted/recent context and direct answers without task noise; runtime scope is approved, while the wider Feishu platform permission grant and a successful live API read remain pending.
- Context continuation, new sessions, project switching, steering, interruption, and queue controls.
- Rejected and explicitly approved colleague actions routed through the owner approval chat under the actual local Codex policy.
- Restart/reconnection exercises and delivery recovery without task replay.
- Optional service installation and activation after foreground acceptance.

Automated behavior checks and the no-inference protocol smoke test are separate evidence. A connected socket and enrollment message do not prove model access or outbound result delivery.
