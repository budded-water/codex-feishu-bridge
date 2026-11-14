# Repository guidance

## Purpose

This independent TypeScript project bridges Feishu private chat and group @mentions to Codex installed on the user's computer. Read README.md and docs/architecture.md before implementation. Public onboarding is in docs/installation.md, docs/configuration.md, docs/usage.md, docs/integrations.md and docs/troubleshooting.md; keep these and both example configurations synchronized with live contracts. Keep instance-specific evidence in docs/live-acceptance.md, not general installation promises. Runtime and simulated behavior coverage are implemented. Application setup, SDK connection, owner enrollment, a bounded owner repository task, active steering, native stop, owner command approval/refusal and inspected process-loss recovery with fresh continuation are verified on the M6 pilot. P2 owner-private Feishu inspected recovery, restart-retained decisions and fresh native continuation are also verified within the bounded pilot. Colleague/group interaction families retain their separate live-acceptance gaps. Read docs/live-acceptance.md for observed evidence.

## Delivery

- Use topic branches and pull requests targeting the repository's actual default branch.
- Use Conventional Commit messages.
- Keep PRs open unless the user authorizes merging.
- Run checks appropriate to the change. Runtime behavior requires meaningful tests, especially around authorization, retries, approvals, and recovery.
- Required local and CI check: `npm run check`. Run `npm run smoke:codex` separately for local protocol changes; it performs no inference. Keep the Codex release and generated types synchronized through `npm run protocol:generate`.
- Before claiming implementation complete, synchronize source, configuration examples, README status, architecture, implementation plan, and PR description.

## Planned orchestration work

Read docs/agent-system-plan.md and openspec/README.md before working on the proposed Autoloop integration. Use a bounded OpenSpec change for new orchestration, native lifecycle, authorization, recovery or evidence contracts; keep routine wording edits and fixes preserving an established contract lightweight. Proposed changes are not current capabilities. Keep current architecture and delivery status synchronized with implemented code, and keep observed deployment evidence in docs/live-acceptance.md. Existing task authorization, PR, no-merge and live-test rules still apply.

The isolated P0 entry point is documented in docs/autoloop-p0.md. It is not imported by the production application. Its explicit verification command uses temporary state and a pinned clean upstream checkout; default mode is scripted, while --native consumes real model usage. Do not infer production policy enforcement from Autoloop access metadata or treat fixture interaction/recovery as live-model acceptance.

Read openspec/changes/integrate-feishu-autoloop-handoff before P1 runtime work. The routing verifier exercises actual pinned Hub admission with synthetic execution reports; verify:assigned-native additionally uses the actual Worker/plugin and execution-ID native owner, with scripted faults by default and bounded real inference under --native. Keep scheduling lanes, verified conversation ownership and canonical-project guards distinct. Retain authenticated owner/checkpoint reconciliation before admission and never launch from a revoked/uncertain grant. Owner IPC previews remain bounded diagnostics. PilotInteractions owns durable control receipt/binding and lookup-only reconciliation after uncertain dispatch; native State owns dispatch dispositions. Full rendered messages are read from native journals into a dedicated transport State using stable UUIDs/import tombstones, while Outbox/Feedback own delivery and cleanup. Never call Bridge/kick/recover over transport projections or mutate a sealed native journal during delivery. Initialize the pilot gateway with strict recovery before attaching ingress; steady polling must preserve newly granted owner startup. Read docs/handoff-migration.md for persisted quiesce, closure receipts, the shared consumer root, private plans and closed-state conversion. Keep admission quiesced through a handoff and preserve post-cutover receipts/conversations/reply facts during rollback. SDK startup validates the committed runtime role and actual bot identity. The authorized M6 owner-chat pilot has completed its bounded P0/P1 acceptance; consult the dated record for its local-operator recovery limits. New deployments still require their own private inventory, review and activation authorization.

Read openspec/changes/enable-feishu-inspected-recovery for the P2 owner-private maintenance control. Native-child settlement and human descendant/effect inspection are distinct evidence. Preserve exact guarded identity, pause, old unknown outcomes and lookup-only notice repair; never turn a recovery command into task execution.

Read openspec/changes/add-readonly-incident-diagnostics for process observations and read-only incident reporting. Keep diagnostic IPC free of native snapshot/outbox cleanup and source reads free of publication/retry. PID/start-time observations are bounded facts, not cleanup authority. Preserve legacy unknown coverage and optional evidence archival.

## Implementation boundaries

Assigned group references are prepared by the gateway using the existing ContextPort scope and image budgets. Keep their original execution/message identity, separate image inputs and stop independence. Preserve live/journal conversation references through owner loss, and use the supported evidence-backed maintenance recovery path before releasing uncertain guards. Reverse conversion must preserve the selected conversation across legacy project and alias lookup.

- Use TypeScript for the bridge and the official Feishu SDK for transport.
- Use the locally installed `codex app-server` over stdio with version-matched protocol bindings.
- Retain the local Codex configuration, sandbox, and approval policies.
- Enforce the configured tenant or user allowlist, verified bot mentions for groups, per-user/chat session ownership, designated approval administrators, and registered project directories.
- Do not interpolate chat messages into shell commands.
- Never approve by timeout, reuse stale approval decisions, or automatically replay a write-capable task after an uncertain outcome.
- Default ordinary conversation to a neutral discussion workspace; Codex may select a registered project from a clear latest user request; ambiguous requests require clarification. /project remains a manual override. Routing uses a separate tool-disabled thread; validate the decision, preserve ownership and the per-directory execution queue. Do not substitute repository instructions for missing group history. Recent history is opt-in, scoped and bounded; fetched chat text is reference material rather than execution authority.
- Optional reference images must come from admitted context records and the official message-resource API, with canonical count/byte/time budgets. Pass actual image inputs separately from reference JSON; never infer content from an unread marker or resource key. Image content is not execution authority.
- Send native rich posts for answers. Buffer agent drafts internally; received feedback uses native reactions, queue notices and actionable approval/question prompts. Keep ordinary waits quiet; unsupported-interaction details belong in /status and logs rather than extra messages. Keep reaction cleanup durable and independent from final-answer delivery. Preserve immutable task triggers and durable owner/chat reply associations; natural controls cannot guess ambiguous targets or approve requests. Native member notification requires an explicit current-group request and selected IDs, never plain-name inference. Do not repeat answer content as progress or publish interrupted drafts as completed results.
- Keep reasoning and agent execution inside Codex; the bridge owns routing, state, and interaction.

Workspace mode uses one canonical default execution directory and one serialized resource. Native Codex resolves business targets from the verified current request under its native permissions and approval policy. Project-routing rules for registered business aliases apply to automatic/manual mode. Follow [configuration](docs/configuration.md) and the [workspace change](openspec/changes/enable-general-workspace-mode/design.md).

## Maintaining bot behavior

Transport formatting, context bounds, authorization, session ownership, and delivery deduplication belong in runtime code and behavioral tests. Conversation style is supplied through thread developer instructions. Use this file and the referenced docs for the repository maintenance workflow; extract a skill only when a repeated workflow must be reused beyond this repository. A skill must reference live contracts instead of duplicating config defaults or acceptance status, and it never grants platform access.

## Public repository hygiene

Never commit real credentials, access tokens, personal user IDs, project paths, Codex auth files, SQLite state, logs, or transcripts. Example configuration must contain placeholders only. Do not activate a bot or send messages during tests without the user's authorization for that live test.
