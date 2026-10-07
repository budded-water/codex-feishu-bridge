# Repository guidance

## Purpose

This independent project bridges Feishu private chat to Codex installed on the user's computer. Read README.md and docs/architecture.md before implementation. The initial repository contains design and configuration examples only.

## Delivery

- Use topic branches and pull requests targeting the repository's actual default branch.
- Use Conventional Commit messages.
- Keep PRs open unless the user authorizes merging.
- Run checks appropriate to the change. Runtime behavior requires meaningful tests, especially around authorization, retries, approvals, and recovery.
- Before claiming implementation complete, synchronize source, configuration examples, README status, architecture, implementation plan, and PR description.

## Implementation boundaries

- Use TypeScript for the bridge and the official Feishu SDK for transport.
- Use the locally installed `codex app-server` over stdio with version-matched protocol bindings.
- Retain the local Codex configuration, sandbox, and approval policies.
- Restrict the initial bot to explicitly authorized private-chat users and registered project directories.
- Do not interpolate chat messages into shell commands.
- Never approve by timeout, reuse stale approval decisions, or automatically replay a write-capable task after an uncertain outcome.
- Keep reasoning and agent execution inside Codex; the bridge owns routing, state, and interaction.

## Public repository hygiene

Never commit real credentials, access tokens, personal user IDs, project paths, Codex auth files, SQLite state, logs, or transcripts. Example configuration must contain placeholders only. Do not activate a bot or send messages during tests without the user's authorization for that live test.
