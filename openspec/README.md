# Specification workflow

OpenSpec records execution, orchestration, authorization, interaction, recovery and evidence contracts. It is a development workflow; pinned Autoloop remains the deployed pilot scheduler.

## Current checkpoint — 2026-11-19

Completed bounded changes have been synchronized into delivered main specifications and archived. Their requirement/scenario bodies are preserved from the delivered deltas; each new main spec has a completed Purpose. Relocated Markdown references are rebased. Archived plans/tasks retain their historical status statements and evidence limits; they are not current merge or deployment instructions.

| Delivered capability | Main specification | Archived change |
| --- | --- | --- |
| Native execution readiness | [codex-execution-readiness](specs/codex-execution-readiness/spec.md) | [P0](changes/archive/2026-11-16-verify-codex-autoloop-execution-boundary/README.md) |
| Remote task handoff | [remote-task-handoff](specs/remote-task-handoff/spec.md) | [P1](changes/archive/2026-11-16-integrate-feishu-autoloop-handoff/README.md) |
| General workspace | [workspace-execution](specs/workspace-execution/spec.md) | [Workspace](changes/archive/2026-11-16-enable-general-workspace-mode/tasks.md) |
| Inspected recovery | [remote-inspected-recovery](specs/remote-inspected-recovery/spec.md) | [Recovery](changes/archive/2026-11-16-enable-feishu-inspected-recovery/tasks.md) |
| Read-only diagnostics | [incident-diagnostics](specs/incident-diagnostics/spec.md) | [Diagnostics](changes/archive/2026-11-16-add-readonly-incident-diagnostics/tasks.md) |
| Unstarted queue withdrawal | [queue-withdrawal](specs/queue-withdrawal/spec.md) | [Queue](changes/archive/2026-11-16-enable-owner-queue-withdrawal/tasks.md) |
| English command dispatch | [chat-commands](specs/chat-commands/spec.md) | [Commands](changes/archive/2026-11-16-standardize-english-chat-commands/tasks.md) |
| Approval cards | [approval-cards](specs/approval-cards/spec.md) | [Cards](changes/archive/2026-11-16-enable-feishu-approval-cards/tasks.md) |
| Bounded verification repair | [bounded-verification-repair](specs/bounded-verification-repair/spec.md) | [Repair](changes/archive/2026-11-16-add-bounded-verification-repair/tasks.md) |
| Read-only verification findings | [verification-findings](specs/verification-findings/spec.md) | [Findings](changes/archive/2026-11-16-add-verification-findings/tasks.md) |
| Owner task replies | [owner-task-replies](specs/owner-task-replies/spec.md) | [Quoted replies](changes/archive/2026-11-18-route-owner-task-replies/tasks.md) |
| Owner matter routing | [owner-matter-routing](specs/owner-matter-routing/spec.md) | [Named matters](changes/archive/2026-11-19-add-owner-matter-routing/tasks.md) |
| Owner task progress | [owner-task-progress](specs/owner-task-progress/spec.md) | [Task progress](changes/archive/2026-11-16-add-owner-task-progress/tasks.md) |
| Browser access handoff | [browser-access-handoff](specs/browser-access-handoff/spec.md) | [Browser handoff](changes/archive/2026-11-18-add-browser-access-handoff/tasks.md) |
| SLS refund observation | [sls-refund-observer](specs/sls-refund-observer/spec.md) | [Standalone observer](changes/archive/2026-11-19-add-sls-refund-observer/tasks.md) |
| SLS refund matters and subscription | [sls-refund-matters](specs/sls-refund-matters/spec.md) | [Managed matters](changes/archive/2026-11-19-connect-sls-refund-matters/tasks.md), [SMQ subscription](changes/archive/2026-11-19-subscribe-sls-refund-events/tasks.md) |

These are implemented contracts with bounded evidence, not universal live acceptance. Owner-private operation is observed on one M6 deployment. Other typed-English, colleague/group, host-login/wake/network and additional fault families retain the limits in [live acceptance](../docs/live-acceptance.md) and [operation](../docs/operation.md).

The delivered [matter follow-up refinement](changes/archive/2026-11-19-clarify-owner-matter-followups/tasks.md) covers short continuations and conflicting answer references. The [M6 acceptance](../docs/live-acceptance.md#2026-11-19-m6-matter-follow-up-rollout) verifies both choices and the resumed threads.

## Delivered SLS observer and subscription

The subscription, read-only observation, owner-private card delivery and quoted Codex continuation were verified on the managed M6 pilot. See the [dated acceptance record](../docs/live-acceptance.md#2026-11-19-m6-sls-refund-subscription) for the scope and observed incident disposition.

The active [refund diagnosis supplement](changes/add-refund-diagnostic-companion/proposal.md) adds a bounded same-batch read and presents it beside the original incident assessment. The existing recovery boundary remains authoritative and deployment evidence is tracked separately.

## Active P3 change

[WeChat visual receipts](changes/add-wechat-visual-receipts/proposal.md) associate
selected original screenshot evidence with an existing owner-private task.
Source and actual Feishu owner acceptance have separate
[tasks](changes/add-wechat-visual-receipts/tasks.md).

[add-project-verification-handoff](changes/add-project-verification-handoff/proposal.md) stays active. Its optional runtime is merged/deployed, and real owner-private fixture `/verify` plus historical `/verification` are accepted. Native execution, project validation, review and publication remain separate.

[Task 3.2](changes/add-project-verification-handoff/tasks.md) still requires an authorized business task with its declared acceptance plan and retained reports. The owner currently has no such task. Fixture success, source checks and layout acceptance do not complete that business gate. This change is not archived or promoted to a main spec by the current synchronization. Broader repair/discovery and Release Kit integration remain separate future work.

[bind-delivery-to-ui-eval](changes/bind-delivery-to-ui-eval/proposal.md) connects
passing Web reports to owner delivery checkpoints. Its scoped Provider diagnostic
acceptance has its own [tasks](changes/bind-delivery-to-ui-eval/tasks.md).

## Where facts belong

The delivered [owner task-progress slice](changes/archive/2026-11-16-add-owner-task-progress/proposal.md) adds read-only owner task browsing and confirmed-message refresh over existing execution facts. Source checks, exact-head CI/independent review, PR merge, managed M6 activation and genuine owner overview/historical-detail/refresh acceptance are complete. The corrected copied rich-post query and same-card update preserve the original task, approval, Hub and evidence baseline without new execution. Requirements are in the main specification and the change is archived. Broader live activity/client/fault families remain separate; this does not close P3 business acceptance or enable proactive task admission.

The delivered [verification findings slice](changes/archive/2026-11-16-add-verification-findings/proposal.md) adds a bounded owner-requested discovery view over retained observations. Corrected source review/CI, PR delivery, managed M6 activation and the real owner-private empty view over latest passing fixture records are verified. Native/project/report hashes and admission/Hub history stayed unchanged across the query. Its normative requirements are in the main specification; non-pass/fault cases retain automated coverage. It does not close P3 business validation or introduce scheduled execution.

The separately delivered [bounded repair change](changes/archive/2026-11-16-add-bounded-verification-repair/proposal.md) implements an explicit opt-in, one-repair extension. Its [tasks](changes/archive/2026-11-16-add-bounded-verification-repair/tasks.md) retain reviewed source, scripted evidence, M6 activation and bounded real owner task/command-approval-button/final/history acceptance. It does not change `/verify` or complete P3 business acceptance. Its normative requirements are now in the main specification; broader interaction/fault/host families retain their dated limits.

| Location | Authority |
| --- | --- |
| [Agent system plan](../docs/agent-system-plan.md) | Direction, tradeoffs, milestone scope and deferred choices |
| specs/<capability>/spec.md | Delivered normative requirements |
| changes/<change>/ | Active delta, design and remaining implementation/acceptance tasks |
| changes/archive/<date>-<change>/ | Historical proposal, design, tasks and delta supporting a delivered baseline |
| [Architecture](../docs/architecture.md) | Current implementation and runtime entry points |
| [Implementation status](../docs/implementation-plan.md) | Current delivery checkpoint and evidence references |
| [Live acceptance](../docs/live-acceptance.md) | Dated observations and their exact scope/limits |

Keep these sources synchronized when a contract changes. A checked scoped task or archived change does not expand the observed audience, host lifecycle, effect-inspection coverage or publication authority.

## Working method

1. Read repository guidance, the applicable delivered specs, current architecture and relevant acceptance records.
2. Use one bounded active change for new orchestration, native lifecycle, authorization, recovery or evidence contracts. Routine wording/fixes preserving a contract remain lightweight.
3. State ownership, actual-effect uncertainty, acceptance scenarios and exclusions before implementation. User authorization and existing delivery/deployment boundaries remain authoritative.
4. Deliver through coherent topic-branch PRs with appropriate checks, exact-head CI and independent review. Do not promote proposed capabilities as implemented.
5. Keep format, simulated behavior, protocol handshake, inference, real owner interaction and deployment evidence distinct. Format validation does not establish behavioral correctness.
6. Sync delivered deltas only after their applicable verification; fill each main spec's Purpose. Preserve requirements/scenarios, historical evidence and valid relocated references.
7. Archive only completed bounded changes. Leave incomplete business acceptance visible instead of checking or archiving it to make the list empty.

With the separately available compatible CLI:

```sh
openspec list --json
openspec status --change add-project-verification-handoff --json
openspec validate --all --strict --no-interactive
```

The tool setup used OpenSpec 2.0.0, schema spec-driven and tools=none. It installed no repository runtime dependency or assistant configuration. Inspect supported commands before upgrading. Markdown artifacts remain reviewable without installing the CLI.

## Active owner-native permission change

[enable-owner-native-permissions](changes/enable-owner-native-permissions/proposal.md) implements explicit owner sandbox/Auto-review, native proposal Remember, owned-rule inspection/revocation and evidence-bound fresh denied-action retry. It remains an active change until its bounded source/delivery/owner-acceptance tasks complete. It does not alter or complete P3 business acceptance or deferred host exercises.

The permission feature's corrected source is merged through [PR #33](https://github.com/budded-water/codex-feishu-bridge/pull/33), with exact-head CI and independent review. Managed pilot activation/readiness and retained-state/policy inventory are verified. The change stays active because genuine owner permission interactions and broader native denial acceptance are unfinished; it is not promoted to a completed main specification by activation.

Genuine owner /rules and /reviews plus one actual Hub/Worker read-only network command approved by native Auto-review are now accepted. The command completed without human approval, changed no native user rules and produced one verified final reply. Genuine owner native Remember/save of one disclosed GitHub read prefix and approval-free reuse under a temporary user reviewer are also accepted. Auto-review is restored; actual owned revocation/renewed review and Auto-review denial/retry remain open. The real save changed user-wide policy and is separate from the preceding unchanged-policy task; see the dated live record.

## Delivered browser access handoff

The [browser specification](specs/browser-access-handoff/spec.md) separates Browser Use saved-origin denial from native review and defines minimal observations, owner-private remediation and one owner-attested linked ordinary continuation with source/conversation revalidation. Its [archived bounded change](changes/archive/2026-11-18-add-browser-access-handoff/tasks.md) retains source, managed deployment and genuine acceptance evidence.

After owner-selected persistent settings and a mixed initial read, an explicit origin setting and one source-linked continuation reached the affected service's login page. The other declared origin's prior read was reused. Actual final/denial-notice delivery, owner confirmation, authenticated historical detail and unchanged original/source evidence/native user rules are verified. These are bounded origin/continuation facts; universal website access, a signed-in service session, business delivery and other native-permission/business/host gates are not inferred. No runtime deployment accompanies this specification synchronization.
