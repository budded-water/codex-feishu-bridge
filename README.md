# Codex Feishu Bridge

A local bridge that lets your Feishu colleagues submit tasks to the Codex installed on your computer, through private chat or group @mentions.

## Status

The team chat bridge is implemented, including default discussion sessions, explicit project execution, optional bounded group context and image inputs, tenant access, verified group @mentions, per-user conversations, native rich replies, administrator approval routing, SQLite state, steering, interruption, and retryable delivery. Automated behavior checks and a real local Codex protocol handshake have passed. The owner application is published, its message scopes/subscription and SDK connection are verified, and private-chat enrollment succeeded. Owner group delivery, a bounded read-only project turn, and a count-only scoped history API read are observed. The supplied screenshot confirms text grounding and bold rendering; a separate real-image vision turn is verified. Native reaction add/lookup/delete APIs are verified; fresh feedback UX, new image-grounded bot replies, other rich rendering, colleague-account access, and administrator approval acceptance remain pending. See [live acceptance](docs/live-acceptance.md) for evidence.

## Design

```text
Feishu private chat / group @bot
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

- Colleagues in one explicitly configured tenant, or a configured user allowlist.
- Private text chats and group text messages that mention this particular bot.
- Separate conversations per user and chat, with configured administrators deciding Codex approval requests.
- Discussion mode by default; `/project` explicitly selects project execution and `/chat` returns to discussion.
- Optional recent group context, limited to at most 50 messages; disabled by default. Quoted-message-only context is supported.
- Optional standalone and rich-post group images passed as actual Codex image inputs; unread or failed media stays explicit.
- Persistent Codex conversation mapping.
- Native Feishu rich-post replies for emphasis, lists, links, and code. Native received reactions, queue feedback and a single delayed stage notice; answer drafts stay private until the final result.
- Text-based approvals, steering, and interruption.
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
2. Follow [Feishu setup](docs/feishu-setup.md) to enable private and group-mention message events and obtain your application-specific open ID, tenant key, and private approval chat using `npm run identify`.
3. Configure team access, approval routing, and your actual project directories in `bridge.config.json`; see [team access](docs/team-access.md). Directory paths must be absolute and exist. State paths are relative to that configuration file unless absolute.
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
| `/project <alias>` | Explicitly enter execution mode for a registered local project. |
| `/chat` | Return to ordinary discussion, without defaulting to a code repository. |
| `/new` | Create a new conversation when the selected session has no pending work. |
| `/status` | Show task counts, process readiness, active stage/event age, and pending requests. |
| `/补充 <text>` | Steer the selected active turn. |
| `/stop` | Interrupt the selected active turn; queued tasks remain queued. |
| `/clear` | Cancel the selected session's queued tasks. |
| `/批准 <id>` / `/拒绝 <id>` | Configured administrators decide a specific approval in its designated chat; a submitter may decline their own question. |
| `/回答 <id> <question-id> <answer>` | Answer a single non-sensitive question. |
| `/help` | Show help. |

In a group, include an actual @mention of the bot before every task or command. Ordinary discussion uses a neutral local session and returns a direct answer. Normal tasks receive a native `OnIt` reaction on their original message. If adding the reaction fails, one short acknowledgment is queued instead. Queued work is identified as not yet started. After 30 seconds (canonical in [feedback.ts](src/feedback.ts)), at most one truthful stage notice is queued; `/status` shows elapsed time, the current stage, and the age of the last correlated Codex event. Process readiness is not model/network health. These are feedback signals, not proof of completion. Draft answers remain internal. Terminal tasks remove only the bot's own reaction, with persisted reconciliation and cleanup retries; delayed statuses are discarded after task completion. HTTP outages can delay feedback or cleanup, and host sleep cannot be reported through an offline channel. A long wait does not automatically interrupt or replay work. Group references require available recent or quoted context; unavailable history is stated instead of substituting local repository rules. Normal text in an explicitly selected project starts a project task. While the project is busy, normal text queues for the next turn. Tasks retain their original session and project even if you switch projects. Aliases pointing at the same directory share one execution queue.

## Verification and operation

```bash
npm run check          # Type checking, behavior tests, production build
npm run smoke:codex    # Actual local stdio handshake; no model inference
```

GitHub Actions runs the automated checks without live Codex or Feishu credentials. Protocol types are generated from the installed Codex executable; `npm run protocol:generate` regenerates them for an upgrade, which requires review and verification before use.

See [operation](docs/operation.md) for macOS service setup and recovery, and [the implementation plan](docs/implementation-plan.md) for remaining live acceptance work.

Recent history is off by default (`groupContextMessages: 0`); opt in to 1–50 only for the agreed group-context scope. It uses one bounded page from the preceding 24 hours, excludes future/other-chat/deleted/bot messages, and keeps failed or unprovided media explicitly unread. A quoted reply can use its explicitly referenced single message without reading recent history. The owner installation has opted in to 50, approved the wider platform group-read scope, and verified a successful scoped API read without printing chat content. Image reading is separately opt-in (`groupContextImages: 0` by default; 1–8 enables it). The owner has enabled 8. It downloads the most recent admitted standalone/post images through the message-resource API, with up to 8 attempts, 10 MiB per image and 20 MiB total; supported PNG/JPEG/GIF/WebP signatures become inline Codex image inputs. Limits are canonical in [context-limits.ts](src/context-limits.ts). New downloads stop once the time budget expires; in-flight requests obey SDK timeouts. Failure or skipped images retain explicit unread markers. The checked-in example remains off by default.

Images in group context are supplied in memory; base64 is separate from the textual context JSON, and the bridge stores no downloaded image files. Codex/model transcript retention still applies.

Limitations: incoming text chats are supported within the configured tenant/user policy. Group output is visible to group members; private-chat output stays in that private chat. Sessions isolate conversation history, while project files, Codex credentials, and installed tools remain shared on the host. Approvals apply to requests raised by the existing Codex policy, not every action. Secret questions, multiple simultaneous questions in one RPC request, and unsupported tool permission interactions are declined. Known gateway/API secrets are redacted from outgoing text; arbitrary secrets in model output still require care. Persistent local state contains task inputs and replies and has no automatic retention policy yet.

Replies use native `post` messages with Markdown elements, compact headings, and reduced empty spacing outside code. Long replies prefer line boundaries and reopen fenced code between parts; exceptionally long lines are split at Unicode character boundaries. Each part uses a stable Feishu idempotency key and never reruns the task. Successful project replies have a small project/number footer; failed or interrupted work is labelled and unfinished drafts are not presented as answers. Delivery remains at least once across external deduplication-window expiry; rare duplicate replies are possible.

Use topic branches and pull requests. Follow the repository guidance in [AGENTS.md](AGENTS.md).

## References

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Official Feishu Node SDK](https://github.com/larksuite/node-sdk)
- [Feishu message content](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/create_json)
- [Feishu message events](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
