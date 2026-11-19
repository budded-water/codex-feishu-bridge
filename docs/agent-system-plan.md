# Agent system direction and delivery plan

Status: the selected composition is deployed through the bounded P0-P2 owner-private workflow on M6, with optional P3 fixture verification/history and message-layout acceptance. Explicit bounded repair also has deployed real owner fixture task, command-approval button, final delivery and read-only history acceptance. Real business-task verification, discovery and optional publication integration remain deferred. Delivered requirements are in the [OpenSpec baseline index](../openspec/README.md); use [dated acceptance](live-acceptance.md) for scope and unexecuted families.

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
- Resolve owner-private [matter routing](owner-matters.md) before dispatch. The retained selection and admitted ordinary work identify candidates for short continuations. Ask the owner when trusted destinations disagree.
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

The [owner task-progress slice](../openspec/changes/archive/2026-11-16-add-owner-task-progress/proposal.md) unifies existing task browsing before further proactive work: paginated history, exact-task detail, authenticated activity and refreshable cards. It reuses current task/executor/scheduler identities and adds no automatic discovery or model manager. Source, deployment and owner acceptance are tracked separately. The M6 owner-private overview, copied rich-post historical repair detail and same-card refresh are accepted with an unchanged original task/evidence baseline; broader live activity/client/fault families remain separate.

| Milestone | Deliverable | Exit evidence |
| --- | --- | --- |
| P0: execution baseline and boundary | Version-aligned Codex integration and an isolated Autoloop execution probe | Matched identities and demonstrated native start/resume, control, cancellation and uncertain-result handling |
| P1: remote workflow | Unified Feishu entry, one scheduling authority and a neutral workspace | Owner-chat assignment, status, follow-up, live interaction, stop and continuation |
| P2: reliable operation | Fault handling, service operation, state recovery and reviewed upgrade/rollback | Duplicate delivery, lost acknowledgement, process restart, stale interaction and result-delivery exercises |
| P3: evidence-based completion | Project checks, UI-eval and required review | Source-bound reports and correct complete/continue/blocked decisions |
| P4: proactive work | Approved discovery sources and bounded execution policies | Evidence-backed candidates, deduplication, authorization and stopping rules |

P0-P2 form the first daily-use target. Later milestones extend the same boundaries. Create a separate OpenSpec change when a milestone becomes actionable; do not create a single permanently open checklist for every future capability.

The first change is [verify-codex-autoloop-execution-boundary](../openspec/changes/archive/2026-11-16-verify-codex-autoloop-execution-boundary/proposal.md). Its isolated implementation is verified; subsequent deployed owner-chat tests complete bounded native interaction/recovery acceptance. The [P1 handoff change](../openspec/changes/archive/2026-11-16-integrate-feishu-autoloop-handoff/README.md) now implements durable admission/source/guards and a single-assignment native executor through the pinned Hub/Worker. Authenticated owner/checkpoint recovery and bounded native continuation are verified. The isolated pilot gateway now also persists correlated controls and projects native prompts/results into the existing human outbox and reaction cleanup. Closed-state migration and both rollback windows now have fixture-tested tools. The authorized fresh M6 activation and bounded owner-private acceptance are complete. The bounded P2 slice adds owner-private Feishu release for eligible inspected unknowns; broader operation, P3 project/UI evidence and P4 discovery remain separate milestones. Check the installed CLI against [the compatibility authority](../src/codex/generated/version.ts) when work starts, rather than copying a version into this roadmap.

## Alternatives and deferred work

The first bounded P4 discovery slice is the delivered [verification findings change](../openspec/changes/archive/2026-11-16-add-verification-findings/proposal.md): an owner-requested read-only view over retained verification records, with exact historical references and evidence/applicability limits. M6 activation and the genuine owner-private latest-fixture query with unchanged execution/evidence records are verified in the dated acceptance record. It does not add a mutable backlog or infer that an observation authorizes a task. The [SLS refund observer](sls-refund-observer.md) provides a bounded external read and incident replay, plus optional managed scheduling, SMQ-based SLS notification intake and owner-private matter notices. Genuine owner replies reuse ordinary admission. An M6 one-shot background run verified SLS reads. The dedicated queue, consumer authorization and managed M6 activation retain separate live gates. Machine-triggered Codex requests remain a separate design decision.

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

- [Autoloop protocol](https://github.com/KKKKhazix/agent-autoloop/blob/bfa6d79d09ab60c410337ffe579de8475edb721d/docs/protocol.md) and [state machines](https://github.com/KKKKhazix/agent-autoloop/blob/bfa6d79d09ab60c410337ffe579de8475edb721d/docs/state-machines.md).
- [Codex app-server](https://learn.chatgpt.com/docs/app-server) and [interface maturity notice](https://learn.chatgpt.com/docs/mcp-server).
- [Hatchet execution guarantees](https://docs.hatchet.run/v1/architecture-and-guarantees).
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md).
- [DSH native Codex provider](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/subagent/subagent-codex/README.md).
- [Dim Pursuit design](https://github.com/arcships/dim/blob/4789808fe844e4b006d085df4d3d879d3616c1d3/docs/design/plugins/Pursuit.md).
- [UI-eval integration contract](https://github.com/budded-water/ui-eval/blob/main/docs/integration-runner.md), [release-kit](https://github.com/budded-water/release-kit) and [agent-followups](https://github.com/budded-water/agent-followups). These are integration references, not bundled dependencies or acceptance claims.


The first bounded P2 slice is [owner-private inspected recovery](../openspec/changes/archive/2026-11-16-enable-feishu-inspected-recovery/proposal.md), addressing the local-command dependency observed during P1 acceptance. Its change tracks candidate checks, independent review and live rollout separately. It reuses the existing ledger and transport; broader operation, process cleanup and project evidence remain later work.


The first P2 inspected-recovery slice has completed real M6 owner-private acceptance, including a fresh continuation after gateway restart. It removes the local reconcile-command requirement for eligible sealed incidents. Actual command descendants and external effects still require human inspection; missing evidence, queued backlog, Hub maintenance and broader operation remain distinct work. P3 project/UI evidence and P4 discovery are not delivered by this slice.

The bounded [read-only incident diagnostics](../openspec/changes/archive/2026-11-16-add-readonly-incident-diagnostics/proposal.md) slice is implemented and live-verified on the M6 owner-private pilot; see the [dated acceptance record](live-acceptance.md). It records task-bound observed process identities and explains native, queue and source-scoped Hub facts through the existing recovery view. Sampling and human effect inspection remain distinct. Process cleanup, backlog modification and automatic discovery are not introduced by this diagnostic slice.


The delivered bounded P2 slice is [owner-private queue withdrawal](../openspec/changes/archive/2026-11-16-enable-owner-queue-withdrawal/proposal.md): remove an exact unstarted request from future admission so remote recovery/maintenance is not blocked by abandoned queued work. A granted execution is outside that control. Real owner-private English queue view and exact-ID withdrawal are verified using a temporarily Hub-only execution host. Worker restoration produced a known nothing run without native execution, and gateway restart retained the decision/notice before fresh same-thread continuation. Normal Worker configuration is restored; quoted withdrawal and withdrawal of queued work while another native task runs retain automated coverage only. Remote process cleanup is deferred because the current sampled PID/start-time identities provide diagnostics rather than a durable process-control capability; a future supervision/containment change must establish that capability at launch. P3 verification and P4 discovery retain their existing boundaries.

## P3 implementation and remaining acceptance

[Project verification handoff](../openspec/changes/add-project-verification-handoff/proposal.md) implements P3's first opt-in runtime: one task, a trusted private project profile, the pinned UI-eval CLI and a durable task/source-bound observation. The native owner retains the existing Worker assignment and execution guard through verification. Native Codex keeps its reasoning autonomy; engine-owned evidence semantics, human review and release authority remain separate. [Project verification](project-verification.md) defines host-command authorization and recovery limits. Source/isolated verification, deployment, real owner transport and business acceptance remain distinct gates; P2 evidence does not establish P3 acceptance.

The bounded M6 owner-private P3 fixture /verify and /verification campaign is now live-verified through actual Feishu, Hub/Worker, native Codex and pinned UI-eval, with unchanged history/evidence across the read-only query. A business task and its declared acceptance plan remain pending; fixture results do not establish a feature, review or release outcome. See the dated acceptance record.

## Bounded repair extension

The [bounded repair change](../openspec/changes/archive/2026-11-16-add-bounded-verification-repair/proposal.md) implements explicit owner opt-in, at most one additional Codex turn, fresh verification and immutable attempt evidence under the existing assignment. Only validated registered functional failures qualify; stop, budget and uncertainty prohibit further work. Reviewed source, scripted scheduler/browser evidence and actual M6 owner-private two-turn repair/command-approval-card/final/history acceptance are verified. Current `/verify` is unchanged. No extra service/model manager, discovery or publication is introduced. See [runtime contract](bounded-repair.md) and [dated evidence](live-acceptance.md); business acceptance, broader interaction/fault families and deferred host exercises stay separate.

## Native permission strategy

The active [permission slice](native-permissions.md) reuses Codex sandbox, native rules and native Auto-review to reduce human waits without introducing a second policy model. Bridge owns exact human identity, immutable review/proposal provenance, fresh retry admission and transport. Persistent rules explicitly retain native user-wide scope; denied-action retry admits one request and does not create a persistent allow rule. Permission behavior is experimental/version-pinned, with source, native fixtures and genuine owner acceptance kept separate in the bounded change.

## Browser access dependency

The bounded [browser access handoff](browser-access.md) addresses a real independent saved-site denial despite successful native Auto-review. It adds minimal native observations, owner-private remediation and one explicit linked continuation, preserving normal browser/native enforcement. Current supported APIs do not expose remote site-policy mutation. Historical tool denial, round completion and verified business delivery remain separate; browser settings and prior side effects require real inspection. This extends the existing executor/transport rather than adding a scheduler or another model.
