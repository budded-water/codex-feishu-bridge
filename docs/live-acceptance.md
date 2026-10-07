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

## Pending

- Published colleague availability, bot membership in the intended group, and a colleague @mention/status round trip. The published-version metadata read did not establish availability.
- Acknowledgment, progress, and final delivery for the intended bounded real inference turn.
- Context continuation, new sessions, project switching, steering, interruption, and queue controls.
- Rejected and explicitly approved colleague actions routed through the owner approval chat under the actual local Codex policy.
- Restart/reconnection exercises and delivery recovery without task replay.
- Optional service installation and activation after foreground acceptance.

Automated behavior checks and the no-inference protocol smoke test are separate evidence. A connected socket and enrollment message do not prove model access or outbound result delivery.
