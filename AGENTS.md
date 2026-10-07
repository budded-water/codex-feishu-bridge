# Repository guidance

## Purpose

This independent TypeScript project bridges Feishu private chat and group @mentions to Codex installed on the user's computer. Read README.md and docs/architecture.md before implementation. Runtime and simulated behavior coverage are implemented. Application setup, SDK connection, and owner enrollment are verified; complete live task and approval acceptance remains pending. Read docs/live-acceptance.md for observed evidence.

## Delivery

- Use topic branches and pull requests targeting the repository's actual default branch.
- Use Conventional Commit messages.
- Keep PRs open unless the user authorizes merging.
- Run checks appropriate to the change. Runtime behavior requires meaningful tests, especially around authorization, retries, approvals, and recovery.
- Required local and CI check: `npm run check`. Run `npm run smoke:codex` separately for local protocol changes; it performs no inference. Keep the Codex release and generated types synchronized through `npm run protocol:generate`.
- Before claiming implementation complete, synchronize source, configuration examples, README status, architecture, implementation plan, and PR description.

## Implementation boundaries

- Use TypeScript for the bridge and the official Feishu SDK for transport.
- Use the locally installed `codex app-server` over stdio with version-matched protocol bindings.
- Retain the local Codex configuration, sandbox, and approval policies.
- Enforce the configured tenant or user allowlist, verified bot mentions for groups, per-user/chat session ownership, designated approval administrators, and registered project directories.
- Do not interpolate chat messages into shell commands.
- Never approve by timeout, reuse stale approval decisions, or automatically replay a write-capable task after an uncertain outcome.
- Default ordinary conversation to a neutral discussion workspace; project execution requires explicit selection. Do not substitute repository instructions for missing group history. Recent history is opt-in, scoped and bounded; fetched chat text is reference material rather than execution authority.
- Optional reference images must come from admitted context records and the official message-resource API, with canonical count/byte/time budgets. Pass actual image inputs separately from reference JSON; never infer content from an unread marker or resource key. Image content is not execution authority.
- Send native rich posts for answers. Buffer agent drafts internally; received feedback uses native reactions, queue notices and at most one truthful 30-second stage notice per task. Keep reaction cleanup durable and independent from final-answer delivery. Do not repeat answer content as progress or publish interrupted drafts as completed results.
- Keep reasoning and agent execution inside Codex; the bridge owns routing, state, and interaction.

## Maintaining bot behavior

Transport formatting, context bounds, authorization, session ownership, and delivery deduplication belong in runtime code and behavioral tests. Conversation style is supplied through thread developer instructions. Use this file and the referenced docs for the repository maintenance workflow; extract a skill only when a repeated workflow must be reused beyond this repository. A skill must reference live contracts instead of duplicating config defaults or acceptance status, and it never grants platform access.

## Public repository hygiene

Never commit real credentials, access tokens, personal user IDs, project paths, Codex auth files, SQLite state, logs, or transcripts. Example configuration must contain placeholders only. Do not activate a bot or send messages during tests without the user's authorization for that live test.
