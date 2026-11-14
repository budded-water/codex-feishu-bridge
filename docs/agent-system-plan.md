# Agent system direction and delivery plan

Status: selected composition, implemented through the [P0 execution probe](autoloop-p0.md) and the P1 handoff. One owner-authorized fresh M6 instance runs the pinned Autoloop gateway/Worker path in general-workspace mode and has completed bounded owner-private acceptance. This roadmap also describes future milestones; use [dated acceptance](live-acceptance.md) to distinguish deployed evidence from planned capability.

## Intended outcome

An operator can assign work through Feishu while away from the execution host, inspect it, add context, answer an actual Codex request, stop it, and continue the associated native Codex conversation. The system can later accept evidence-backed observations and scheduled investigations under explicit execution policies.

The initial scope is one persistent macOS execution host, one Feishu bot, an operator acceptance chat and one canonical neutral workspace. Remote devices control work on that host; they do not migrate a running process. Native Codex remains the default harness and retains its local authentication, tools, configuration and permissions. Existing desktop chats and UI-only integrations are not automatically attached.

## Recommended composition

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Interaction | One Feishu gateway, reusing this bridge | Identity, context, reply association, transport deduplication and delivery |
| Orchestration | A reviewed, pinned Autoloop release or commit | Event routing, scheduling, admission, rounds and subsequent triggers |
| Reasoning and tool execution | Native Codex | Task interpretation, exploration and tool use |
| Execution integration | A bridge-owned app-server adapter | Version-matched protocol, native thread/turn control, approval handling and outcome reconciliation |
| Project verification | Existing project commands and optional UI-eval | Candidate-bound checks, evidence and declared human review |
| Mobile publication | Optional release-kit integration | Publication authority, operation journals and external outcome reconciliation |
| Discovery | Optional follow-up collection, monitoring and scheduled checks | Evidence-backed candidate work; discovery does not itself authorize execution |

This repository is the integration home. Autoloop is an external dependency, not a second product fork. Project-specific checks and release adapters stay with their existing owners. Protocol, transport and scheduling do not embed a new permanent model-backed manager.

The first integration must work through documented extension boundaries. If it needs a kernel change, record the precise missing contract and assess it before expanding scope; do not silently fork Autoloop.

## Target responsibility boundaries

~~~mermaid
flowchart TB
    F[Feishu] <--> G[Unified gateway]
    E[Authorized observations and schedules] --> A[Autoloop orchestration]
    G <-->|Tasks, queries and business replies| A
    A <-->|Execution assignments and receipts| X[Worker and native Codex adapter]
    G <-->|Live controls and native requests| X
    X <--> C[Native Codex]
    X --> P[Project verification or delivery adapter]
    P --> V[Evidence and actual-state checks]
    V -->|Verified result or follow-up event| A
~~~

Arrows show the proposed logical integration, not installed services or a mandatory task sequence. Codex keeps autonomy within an assigned task. External orchestration governs admission, resource use, evidence boundaries and subsequent work.

| Fact | Authority after the relevant integration is delivered |
| --- | --- |
| Scheduling and round state | Autoloop |
| Message receipt, ownership and delivery state | Gateway records |
| Native conversation and execution state | Codex, with adapter identity/outcome records |
| Verification result | The verifier's validated report bound to its source and scope |
| Publication outcome | The release tool's journal plus platform reconciliation |
| Accepted backlog item, if the existing follow-up flow is used | Its existing task store; not a duplicate orchestration backlog |

The default entry retains its legacy queue; the authorized M6 pilot uses the delivered single-assignment handoff. The target has one authority for each execution assignment. Message inbox/outbox records are transport state, not a competing business scheduler.

## Execution and interaction rules

- Correlate an operator task with its Autoloop round, native thread/turn, interactions and evidence. A continuing task must not accidentally move to another conversation, project or owner.
- Only acknowledge durable acceptance as accepted work. Socket readiness, received reactions and a successful submission response do not establish completion.
- Keep task execution and answer delivery independent. Retrying an answer must not rerun Codex.
- Business questions can finish a round and become subsequent events. A native approval belongs to a live protocol request and may keep its turn active; it cannot be replaced with an unrelated later approval.
- A stop request is pending until the actual execution settles. Inconclusive cancellation or lost acknowledgement is not proof that it stopped or failed.
- Reconcile uncertain execution and external effects before considering another attempt. A missing lease alone does not prove the original process is gone.
- Initially serialize writes to a project. Worktrees isolate source; shared ports, browsers, simulators and backends require their own admission policy.
- Preserve existing tenant/user, chat, mention, administrator and project-directory checks. Scheduling cannot confer new authority.

## Completion and autonomy

A round ending is not a business objective being achieved. Completion needs the required work, valid evidence and an accurate account of unresolved items and delivery state.

Use deterministic project checks where available and an independent review where the project requires one. A reviewer must inspect real artifacts or reports rather than repeat the worker's final claim. The useful idea borrowed from Dim's Goal/Pursuit is a separation between requesting completion and judging completion; this plan does not import its runtime.

The initial UI integration uses UI-eval's deterministic integration runner. It seals source/engine scope, captures evidence and validates reports; it does not repair. Product findings can be returned to the associated Codex task within its declared budget. Infrastructure failures, incomplete cleanup, missing human review and stale evidence remain distinct outcomes. If UI-eval's optional agent mode is adopted later, it owns its bounded repair loop; an outer scheduler must not restart it indefinitely.

Release-kit is optional for mobile delivery. Its journal, evidence revalidation and uncertain-operation recovery remain authoritative. A status projection or successful process exit does not grant publication permission.

Research, document and data tasks can use the same native executor with appropriate tools, contexts and completion evidence. Expand task types when a concrete integration is needed, rather than first adding another harness.

## Delivery milestones

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| P0: execution baseline and boundary | Version-aligned Codex integration and an isolated Autoloop execution probe | Matched identities and demonstrated native start/resume, control, cancellation and uncertain-result handling |
| P1: remote workflow | Unified Feishu entry, one scheduling authority and a neutral workspace | Owner-chat assignment, status, follow-up, live interaction, stop and continuation |
| P2: reliable operation | Fault handling, service operation, state recovery and reviewed upgrade/rollback | Duplicate delivery, lost acknowledgement, process restart, stale interaction and result-delivery exercises |
| P3: evidence-based completion | Project checks, UI-eval and required review | Source-bound reports and correct complete/continue/blocked decisions |
| P4: proactive work | Approved discovery sources and bounded execution policies | Evidence-backed candidates, deduplication, authorization and stopping rules |

P0-P2 form the first daily-use target. Later milestones extend the same boundaries. Create a separate OpenSpec change when a milestone becomes actionable; do not create a single permanently open checklist for every future capability.

The first change is [verify-codex-autoloop-execution-boundary](../openspec/changes/verify-codex-autoloop-execution-boundary/proposal.md). Its isolated implementation is verified; subsequent deployed owner-chat tests complete bounded native interaction/recovery acceptance. The [P1 handoff change](../openspec/changes/integrate-feishu-autoloop-handoff/README.md) now implements durable admission/source/guards and a single-assignment native executor through the pinned Hub/Worker. Authenticated owner/checkpoint recovery and bounded native continuation are verified. The isolated pilot gateway now also persists correlated controls and projects native prompts/results into the existing human outbox and reaction cleanup. Closed-state migration and both rollback windows now have fixture-tested tools. The authorized fresh M6 activation and bounded owner-private acceptance are complete. Inspected unknown recovery currently uses local maintenance; P2 operation, P3 project/UI evidence and P4 discovery remain separate milestones. Check the installed CLI against [the compatibility authority](../src/codex/generated/version.ts) when work starts, rather than copying a version into this roadmap.

## Alternatives and deferred work

| Candidate | Decision for this plan | Reason |
| --- | --- | --- |
| Hatchet | Defer | Durable orchestration is useful, but native Codex integration is still ours and the service/database adds operating cost. Revisit for demonstrated cross-task orchestration needs. |
| Pi | Keep as a separate harness candidate | A flexible SDK can support a custom runtime, but adds conversation/tool-loop and completion responsibilities to this project. |
| DSH | Keep for a separate general-agent experiment | Goal continuation is relevant; its documented native Codex provider is one-shot and does not supply the required human continuation path. |
| Dim | Keep for a separate general-agent experiment | Timeline, Goal/Pursuit and environment plugins fit the long-term direction, but are a distinct runtime with evolving interfaces. |
| A new scheduler or harness | Do not build initially | Reuse the existing cores and implement the specific adapters and business contracts. |

This is a fit and maintenance decision, not a benchmark ranking. Research, simulated tests and inspected source are not end-to-end acceptance of the combined system. No token-saving percentage or reliability advantage over another full stack is established.

## Maintenance and evidence

Maintain channel integration, the native executor, and project policies/adapters. Pin upstream revisions; review upgrades against authorization, live controls, cancellation, uncertain results and state compatibility. The app-server interface is evolving, so a routine dependency update cannot stand in for protocol acceptance.

Collect queue time, execution time, human wait, verification time, delivery delay, duplicate-execution incidents, unknown outcomes and available model usage. Compare equivalent tasks and settings before claiming an efficiency gain.

Document responsibilities are deliberately separate:

- This plan owns direction, tradeoffs and milestone scope.
- OpenSpec change artifacts own proposed behavioral contracts and their implementation tasks.
- [Architecture](architecture.md) owns current implementation structure; update it when implementation actually changes.
- [Implementation status](implementation-plan.md) owns current delivery status and references acceptance evidence.
- [Live acceptance](live-acceptance.md) owns observed deployment-specific evidence. Do not copy private identities, paths, logs or transcripts into planning artifacts.

OpenSpec format validation does not establish implementation, protocol compatibility or live acceptance. Sync delivered delta specs only after implementation and applicable verification; leave future requirements in changes.

## Primary references

- [Autoloop protocol](https://github.com/KKKKhazix/agent-autoloop/blob/c9ec4a187cab49627947e7e33db265ec143db3b8/docs/protocol.md) and [state machines](https://github.com/KKKKhazix/agent-autoloop/blob/c9ec4a187cab49627947e7e33db265ec143db3b8/docs/state-machines.md).
- [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [interface maturity notice](https://learn.chatgpt.com/docs/mcp-server).
- [Hatchet execution guarantees](https://docs.hatchet.run/v1/architecture-and-guarantees).
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).
- [DSH native Codex provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-codex/README.md).
- [Dim Pursuit design](https://github.com/arcships/dim/blob/4789808fe844e4b006d085df4d3d879d3616c1d3/docs/design/plugins/Pursuit.md).
- [UI-eval integration contract](https://github.com/budded-water/ui-eval/blob/main/docs/integration-runner.md), [release-kit](https://github.com/budded-water/release-kit) and [agent-followups](https://github.com/budded-water/agent-followups). These are integration references, not bundled dependencies or acceptance claims.


The first bounded P2 slice is [owner-private inspected recovery](../openspec/changes/enable-feishu-inspected-recovery/proposal.md), addressing the local-command dependency observed during P1 acceptance. Its change tracks candidate checks, independent review and live rollout separately. It reuses the existing ledger and transport; broader operation, process cleanup and project evidence remain later work.
