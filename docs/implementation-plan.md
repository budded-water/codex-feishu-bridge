# Implementation and acceptance status

The private-text-chat MVP is implemented. Automated checks and a real local Codex handshake pass. The owner will create the Feishu application after code delivery; live Feishu and inference acceptance are pending.

| Milestone | Code and automated evidence | Remaining acceptance |
| --- | --- | --- |
| Codex adapter | Version-matched types; stdio initialization, request correlation, events, interruption, timeout and exit coverage. Actual local handshake and model catalog smoke test without inference. | A bounded real turn and inference access. |
| Feishu transport | SDK long connection, private text normalization, allowlist, deduplication, progress and result delivery. | Application provisioning, published permissions/availability, live round trip. |
| Sessions and state | SQLite mappings, project queues, steering, stopping, clearing, restart recovery, and outbox retry coverage. | Live follow-up, disconnect, and restart exercises. |
| Interactive requests | Correlated command/file approvals, timeout denial, stale invalidation, single-question replies, unsupported-request denial. | Live rejection and approval under the actual local policy. |
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

Group chats, card callbacks, attachments, arbitrary paths, task replay, cloud hosting, team access, secret questions, multi-question RPCs, and interactive permission grants are outside the initial scope.

Automatic data retention and exported metrics are not implemented. Delivery is at least once across external deduplication-window expiry. Existing desktop chats and UI-only integrations are not automatically attached.
