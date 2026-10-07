# Codex Feishu Bridge

A local bridge that lets you interact with the Codex installed on your computer through Feishu.

## Status

The private-chat MVP is implemented, including Codex stdio control, project sessions, SQLite state, text approvals, steering, interruption, and retryable result delivery. Automated behavior checks and a real local Codex protocol handshake have passed. The owner application is published, its message scopes and subscription are verified, the SDK long connection is connected, and private-chat challenge enrollment has succeeded. A real inference/result round trip and interactive approval acceptance remain pending. See [live acceptance](docs/live-acceptance.md) for observed evidence.

## Design

```text
Feishu private chat
        ↕
Feishu Open Platform
        ↕ outbound SDK WebSocket connection
Local TypeScript bridge
        ↕ JSON-RPC over stdin/stdout
Local codex app-server
        ↕
Local projects, Codex configuration, skills, and tools
```

The bridge runs on your computer. Codex performs the agent work using its normal model service and local execution environment. The bridge owns message routing, conversation mapping, progress delivery, and approval forwarding.

See [the architecture](docs/architecture.md) for lifecycle, session, and recovery details, and [the implementation plan](docs/implementation-plan.md) for acceptance criteria.

## Initial scope

- One authorized user, using private text chats with the application bot.
- Explicit project selection from a configured directory allowlist.
- Persistent Codex conversation mapping.
- Progress and final results, text-based approvals, steering, and interruption.
- Local operation without a public HTTP listener.

The host computer must be awake and connected to the network. Messages sent while it is offline are not guaranteed to be recovered. Existing desktop conversations are not automatically attached to the bridge.

## Requirements and setup

Use Node.js 24 or later and an installed, authenticated Codex. The exact supported Codex release is generated in [the protocol version file](src/codex/generated/version.ts); startup checks that it matches your executable.

```bash
npm ci
cp .env.example .env
cp bridge.config.example.json bridge.config.json
```

1. Create your own Feishu self-built application with bot capability and enter its credentials in the local `.env`.
2. Follow [Feishu setup](docs/feishu-setup.md) to enable private message events and obtain your open ID for this particular application using `npm run identify`.
3. Configure exactly one allowed user and your actual project directories in `bridge.config.json`. Directory paths must be absolute and exist. State paths are relative to that configuration file unless absolute.
4. Verify configuration, then build and start:

```bash
npm run doctor
npm run build
npm start
```

`doctor` verifies local configuration, credential presence, and the Codex version. It does not verify authentication, inference access, or Feishu permissions. `npm run dev` runs the TypeScript entry point directly during development.

Keep `.env`, `bridge.config.json`, the local state database, transcripts, and credentials outside version control. Published examples use placeholders only.

## Chat commands

| Command | Action |
| --- | --- |
| `/project <alias>` | Select a registered local project. |
| `/new` | Create a new conversation when the selected session has no pending work. |
| `/status` | Show task counts, Codex readiness, and pending requests. |
| `/补充 <text>` | Steer the selected active turn. |
| `/stop` | Interrupt the selected active turn; queued tasks remain queued. |
| `/clear` | Cancel the selected session's queued tasks. |
| `/批准 <id>` / `/拒绝 <id>` | Decide a specific pending approval. |
| `/回答 <id> <question-id> <answer>` | Answer a single non-sensitive question. |
| `/help` | Show help. |

Normal text starts a task. While the project is busy, normal text queues for the next turn. Tasks retain their original session and project even if you switch projects. Aliases pointing at the same directory share one execution queue.

## Verification and operation

```bash
npm run check          # Type checking, behavior tests, production build
npm run smoke:codex    # Actual local stdio handshake; no model inference
```

GitHub Actions runs the automated checks without live Codex or Feishu credentials. Protocol types are generated from the installed Codex executable; `npm run protocol:generate` regenerates them for an upgrade, which requires review and verification before use.

See [operation](docs/operation.md) for macOS service setup and recovery, and [the implementation plan](docs/implementation-plan.md) for remaining live acceptance work.

Limitations: only private text chat with one configured user is supported. Secret questions, multiple simultaneous questions in one RPC request, and unsupported tool permission interactions are declined. Known gateway/API secrets are redacted from outgoing text; arbitrary secrets in model output still require care. Persistent local state contains task inputs and replies and has no automatic retention policy yet.

Sending results uses a stable Feishu idempotency key and never reruns the task. Delivery remains at least once across external deduplication-window expiry; rare duplicate replies are possible.

Use topic branches and pull requests. Follow the repository guidance in [AGENTS.md](AGENTS.md).

## References

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Official Feishu Node SDK](https://github.com/larksuite/node-sdk)
- [Feishu message events](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
