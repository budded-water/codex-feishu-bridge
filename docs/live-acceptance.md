# Live acceptance evidence

This record describes the owner installation. It does not imply that a new installation is already configured. Keep credentials, account identifiers, project paths, and chat transcripts in private local configuration/state only.

## Observed

- A dedicated self-built bot application is enabled and published.
- The developer console shows private-message receive and bot-send scopes as added, and the message-received event is subscribed.
- The official SDK connected; the developer console verified the persistent connection as connected.
- Challenge enrollment received the owner's matching private message and exited successfully.
- The enrolled account is the single local allowlisted account.
- Local configuration and the installed Codex protocol version passed `doctor`.
- The bridge initialized local Codex and connected to Feishu in foreground mode.
- A local launchd definition passed `plutil -lint`; it has not been installed or activated.

## Pending

- Status reply, acknowledgment, progress, and final delivery for a bounded real inference turn.
- Context continuation, new sessions, project switching, steering, interruption, and queue controls.
- Rejected and explicitly approved actions under the actual local Codex policy.
- Restart/reconnection exercises and delivery recovery without task replay.
- Optional service installation and activation after foreground acceptance.

Automated behavior checks and the no-inference protocol smoke test are separate evidence. A connected socket and enrollment message do not prove model access or outbound result delivery.
