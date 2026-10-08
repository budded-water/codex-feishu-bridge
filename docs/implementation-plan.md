# Implementation and acceptance status

The team text-chat bridge is implemented. Automated checks and a real local Codex handshake pass. The owner application is published, message scopes/subscription and SDK connection are verified, and owner challenge enrollment has succeeded. Tenant access, verified group mentions, isolated user sessions, default discussion mode, optional bounded text/image context, direct discussion replies, native rich-post formatting, and administrator approval routing are implemented and behavior-tested. Owner group transport and a bounded read-only turn are observed; new image-grounded group replies, colleague-account access, and administrator approval acceptance remain pending; see [live acceptance](live-acceptance.md).

| Milestone | Code and automated evidence | Remaining acceptance |
| --- | --- | --- |
| Codex adapter | Version-matched types; stdio initialization, request correlation, events, interruption, timeout and exit coverage. Actual local handshake and model catalog smoke test without inference. | The bounded owner read-only turn completed; a real-image vision turn is verified; combined image/context group replies still need live acceptance. |
| Feishu transport | SDK long connection, private/group text normalization, tenant/user access policy, deduplication, native rich posts, bounded group image downloads and inline Codex vision inputs, Unicode/code-fence splitting, native received reactions with durable cleanup, queue feedback and one delayed stage notice, and single final-answer delivery. Owner application provisioning, published permissions, message subscription, SDK connection, and challenge enrollment verified; published group-mention scope and bot identity API also verified. | An owner group mention and delivery occurred, exposing missing context. The owner has increased the opted-in scope to 50 preceding-group records within 24 hours. After explicit approval of the wider platform scope, the grant is Added and a fresh bounded read succeeded. The supplied screenshot confirms earlier text context and bold rendering. New image-grounded replies, links/lists/code rendering, and colleague-account acceptance remain pending. |
| Sessions and state | SQLite mappings, project queues, steering, stopping, clearing, restart recovery, and outbox retry coverage. | Live follow-up, disconnect, and restart exercises. |
| Interactive requests | Designated administrator chat, deciding-actor audit, correlated command/file approvals, timeout denial, stale invalidation, single-question replies, unsupported-request denial. | Live rejection and approval under the actual local policy. |
| Host operation | Clean shutdown, heartbeat lock, bounded restart, doctor, challenge enrollment, and launchd generation. Generated plist validated locally. | Foreground acceptance, optional service installation and activation. |

## Sharing and onboarding

The public README and Chinese deployment/usage guides describe independent installations and colleagues using an existing host separately. All config fields/defaults, personal/team examples, protocol-version installation, enrollment/subscription order, feature/tool boundaries, identities, troubleshooting and update/service paths are documented. The initial implementation was merged through PR #1. Standard download instructions now use main; testing an unmerged follow-up PR requires selecting that PR branch. No runtime behavior or private deployment configuration is changed by this documentation work. New hosts still need their own real acceptance.

## Feedback acceptance

Normal tasks receive a native `OnIt` reaction on their original message. If adding the reaction fails, one short acknowledgment is queued instead. Queued work is identified as not yet started. After 30 seconds, at most one truthful stage notice is queued; `/status` shows elapsed time, the current stage, and the age of the last correlated Codex event. Process readiness is not model/network health. These are feedback signals, not proof of completion. Draft answers remain internal. Terminal tasks remove only the bot's own reaction, with persisted reconciliation and cleanup retries; delayed statuses are discarded after task completion. HTTP outages can delay feedback or cleanup, and host sleep cannot be reported through an offline channel. A long wait does not automatically interrupt or replay work. Real add/own-lookup/delete/absence API verification succeeded; fresh bot-message UX acceptance is tracked in live-acceptance.md.

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

Card callbacks, non-image attachments, arbitrary paths, task replay, cloud hosting, external tenant access, secret questions, multi-question RPCs, and interactive permission grants are outside the initial scope.

Automatic data retention and exported metrics are not implemented. Delivery is at least once across external deduplication-window expiry. Existing desktop chats and UI-only integrations are not automatically attached.
