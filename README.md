# Codex Feishu Bridge

A local bridge that lets you interact with the Codex installed on your computer through Feishu.

## Status

This repository currently contains the reviewed architecture and configuration examples. The bridge runtime is planned; it is not implemented or connected to a live Feishu application yet.

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

## Configuration examples

The examples are a proposed bridge configuration contract. They are not consumed by a runtime yet.

1. Copy `.env.example` to `.env` and supply credentials for your own Feishu self-built application.
2. Copy `bridge.config.example.json` to `bridge.config.json` and configure the allowed user and project directories.
3. Use your locally installed and authenticated Codex. The bridge will load its local configuration; individual tool availability and authorization must be verified during implementation.

Keep `.env`, `bridge.config.json`, the local state database, transcripts, and credentials outside version control. Published examples use placeholders only.

## Development and delivery

Implementation will use TypeScript and the official Feishu SDK, with Codex controlled through the app-server protocol. Dependency versions and generated protocol bindings will be pinned when implementation begins.

Use topic branches and pull requests. Follow the repository guidance in [AGENTS.md](AGENTS.md).

## References

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Official Feishu Node SDK](https://github.com/larksuite/node-sdk)
- [Feishu message events](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
