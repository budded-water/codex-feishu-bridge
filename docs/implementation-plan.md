# Implementation and acceptance status

The team text-chat bridge is implemented. Automated checks and a real local Codex handshake pass. The owner application is published, message scopes/subscription and SDK connection are verified, and owner challenge enrollment has succeeded. Tenant access, verified group mentions, isolated user sessions, default discussion mode, optional bounded context, direct discussion replies, native rich-post formatting, and administrator approval routing are implemented and behavior-tested. Owner group transport and a bounded read-only turn are observed; context-grounded discussion, colleague-account access, and administrator approval acceptance remain pending; see [live acceptance](live-acceptance.md).

| Milestone | Code and automated evidence | Remaining acceptance |
| --- | --- | --- |
| Codex adapter | Version-matched types; stdio initialization, request correlation, events, interruption, timeout and exit coverage. Actual local handshake and model catalog smoke test without inference. | The bounded owner read-only turn completed; context-grounded group discussion still needs live acceptance. |
| Feishu transport | SDK long connection, private/group text normalization, tenant/user access policy, deduplication, native rich posts, bounded Unicode/code-fence splitting, short project activity notices, and single final-answer delivery. Owner application provisioning, published permissions, message subscription, SDK connection, and challenge enrollment verified; published group-mention scope and bot identity API also verified. | An owner group mention and delivery occurred, exposing missing context. The owner opted in to 20 preceding-group records within 24 hours. After explicit approval of the wider platform scope, the grant is Added and a fresh bounded read succeeded. Client rendering, context-grounded discussion, and colleague-account acceptance remain pending. |
| Sessions and state | SQLite mappings, project queues, steering, stopping, clearing, restart recovery, and outbox retry coverage. | Live follow-up, disconnect, and restart exercises. |
| Interactive requests | Designated administrator chat, deciding-actor audit, correlated command/file approvals, timeout denial, stale invalidation, single-question replies, unsupported-request denial. | Live rejection and approval under the actual local policy. |
| Host operation | Clean shutdown, heartbeat lock, bounded restart, doctor, challenge enrollment, and launchd generation. Generated plist validated locally. | Foreground acceptance, optional service installation and activation. |

## Required checks

Run `npm run check` for type checking, behavior tests, and production build. GitHub Actions runs it without external credentials. For protocol changes, run `npm run smoke:codex` on compatible local Codex; it does not create a turn or perform inference.

The generated release constant is canonical for compatibility. Use `npm run protocol:generate` and review changes when upgrading Codex.

## Live acceptance checklist

- Configure a dedicated self-built app and enroll the owner with `npm run identify`.
- Verify private text reaches the correct project and returns a real result.
- Verify context, project switching, and queued task isolation.
- Verify steering, stopping, and queue clearing.
- Verify rejected and explicitly accepted actions reach the correct task.
- Verify process replacement and late responses cannot authorize an old request.
- Verify delivery recovery does not repeat task execution.
- Optionally activate the reviewed local service after foreground acceptance.

Follow docs/feishu-setup.md and record observed results before marking these complete.

## Limitations and follow-up scope

Card callbacks, attachments, arbitrary paths, task replay, cloud hosting, external tenant access, secret questions, multi-question RPCs, and interactive permission grants are outside the initial scope.

Automatic data retention and exported metrics are not implemented. Delivery is at least once across external deduplication-window expiry. Existing desktop chats and UI-only integrations are not automatically attached.
