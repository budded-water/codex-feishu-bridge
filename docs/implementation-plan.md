# Implementation plan

All milestones below are planned. No runtime or live Feishu integration is implemented in the initial repository.

## 1. Local Codex protocol adapter

- Launch the installed `codex app-server` through stdio and complete initialization.
- Create, resume, and interrupt threads and turns, and stream agent output.
- Correlate concurrent request IDs, surface protocol errors, and clean up on process exit.
- Generate version-matched protocol bindings and record the compatible Codex version.

Acceptance: local integration smoke test starts a bounded turn and distinguishes completion, interruption, and failure. Tests cover process termination and request correlation without using live paid inference by default.

## 2. Feishu message transport

- Connect a self-built application bot through the official SDK long connection.
- Accept only an explicitly allowed user's private text messages.
- Deduplicate event retries and separate handler acknowledgment from background task execution.
- Deliver acknowledgment, throttled progress, and final results.

Acceptance: unauthorized and duplicate events cannot start tasks. A live private message reaches the local Codex adapter and returns a result. Live validation requires the owner's application configuration and is recorded separately from automated tests.

## 3. Sessions and local state

- Validate registered project directories and persist conversation mappings in SQLite.
- Implement project selection, new sessions, status, steering, and stopping.
- Serialize execution per project directory and bind queued work to its original session.
- Persist delivery state so sending a result can be retried without rerunning a task.

Acceptance: restart restores idle conversations, interrupted work is not replayed, queued work cannot move projects, and result delivery retries do not repeat execution.

## 4. Interactive approvals

- Render the actual requested action and a unique approval identifier.
- Validate sender, chat, thread, turn, live request, and process generation.
- Forward supported decisions, reject stale decisions, and decline or cancel on timeout.
- Handle supported user input requests; explicitly reject unsupported request families.

Acceptance: tests demonstrate that unauthorized, duplicate, expired, and prior-process replies cannot authorize actions. A live approval round trip works for a bounded local action.

## 5. Personal host operation

- Add a documented macOS service setup and clean shutdown behavior.
- Add health diagnostics that omit credentials and chat contents.
- Complete installation instructions, credential setup, retention controls, and troubleshooting.

Acceptance: restart and disconnect exercises preserve correct task states. The README clearly separates automated checks, live integration evidence, and remaining limitations.

## Initial scope exclusions

Group chats, card callbacks, attachments, arbitrary project paths, automatic task replay, cloud hosting, and shared team access are deferred. Revisit them only after the personal private-chat workflow has live evidence.
