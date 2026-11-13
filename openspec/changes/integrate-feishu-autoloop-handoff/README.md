# P1: Feishu and Autoloop handoff

Status: durable admission/source/guards and single-assignment native execution are implemented. The pinned Hub/Worker, authenticated owner/checkpoint recovery and bounded native conversation continuation are verified. Durable control relay and prompt/result/reaction transport projections are implemented in the isolated gateway. Migration and activation remain open. P0 real-model interaction/recovery acceptance remains in the task list.

Read [proposal](proposal.md), [design](design.md), [requirements](specs/remote-task-handoff/spec.md) and [tasks](tasks.md). The design owns the complete proposed handoff contract; [current architecture](../../../docs/architecture.md) distinguishes implemented isolated entry points from the production runtime. Keep this change open until its remaining tasks pass.

## Responsibilities and implementation

| Component | Current responsibility |
| --- | --- |
| [FeishuAdmission](../../../src/channels/feishu-admission.ts) | Existing SDK event normalization and stable bot binding before channel-neutral admission |
| [PilotAdmission](../../../src/handoff/gateway.ts) / [AdmissionStore](../../../src/handoff/store.ts) | Immutable original message/request/conversation/execution, source intent, canonical-project guards, retained native conversation and explicit recovery decisions |
| [SourceOutbox](../../../src/handoff/source.ts) | Stable opaque event delivery, routing reconciliation and verification of the source event's actual claimed run |
| Pinned Autoloop Hub/Worker | One request lane, project group serialization, process supervision and receipt delivery |
| [Native plugin](../../../experiments/autoloop/native-agent.ts) / [assignment entry](../../../src/handoff/run-assignment.ts) | Public Turn/context validation against documented rules and source APIs; one retained request per execution; normalized receipt after runner exit |
| [NativeExecutions](../../../src/handoff/native.ts) | Existing Bridge/State for one assigned task; verified native thread continuation, private owner challenge, terminal checkpoint and recovery without replay |
| [PilotInteractions](../../../src/handoff/interactions.ts) / [HandoffTransport](../../../src/handoff/transport.ts) | Durable correlated controls and lookup-only acknowledgement recovery; native journal projections into existing Outbox/Feedback |
| Native Codex | Existing host identity, policy, reasoning, tools and conversation history |

The production listener still uses its original queue. The new entry does not connect a second Feishu consumer. Its private configuration supplies scope, stateDirectory, bridgeConfig and hubUrl; HANDOFF_CONFIG selects that file, HANDOFF_SOURCE_KEY supplies the private source credential, and HANDOFF_RUNNER selects the built assignment entry. The verifier creates all of these with synthetic identities and temporary state. They are implementation inputs, not a completed deployment interface.

Active work permits subsequent queue admission. Uncertain work holds the canonical project across aliases and reopening. An authenticated owner checkpoint can settle its exact execution after child exit. Alternatively, the operator can record explicit settlement/effects inspection evidence and authorize fresh remaining work. Repeated/stale reports preserve newer guards. A revoked or uncertain permit cannot start another native process/turn.

Native State remains canonical for native dispatch and rendered messages. The gateway retains immutable control identity and native target, writes dispatch intent before IPC and queries the original native record after lost acknowledgement. It never automatically resends an uncertain control. A dedicated transport State imports full native messages with stable UUIDs and retained import tombstones, reusing Outbox and Feedback. It gates live prompts/statuses against the native owner before sending; sealed final replies survive owner/gateway shutdown without another model turn. Reaction cleanup retries independently.

Call and await PilotInteractions.start() before attaching normalized Feishu ingress; it performs strict retained-owner recovery before starting periodic synchronization. Programmatic fixtures may call recover()/flush() explicitly. Steady polling preserves the newly granted worker startup window. The deployed listener is still separate, and the pilot gateway must be integrated with exclusive consumer/state ownership through the migration tooling. Private IPC previews remain diagnostics. This is a single-host implementation: read-only native journal access is not a remote-worker protocol.

## Reproduce the scoped checks

Use Node 24 and a clean checkout matching [the shared upstream pin](../../../experiments/autoloop/source.json). No global Autoloop installation is required.

```bash
npm ci
npm run check
npm run smoke:codex
npm run verify:handoff-routing -- /absolute/path/to/pinned-autoloop
npm run verify:assigned-native -- /absolute/path/to/pinned-autoloop
```

The routing command uses actual Hub HTTP with synthetic execution reports. The assigned-native command also starts the actual Worker and standalone plugin with a scripted Codex RPC child. It covers Worker/gateway restart, lost control acknowledgement with lookup-only recovery, duplicate controls, retained checkpoint reuse, same-conversation continuation, administrator approval ownership, full native prompt/final projection, observed stop, lost start acknowledgement, native/owner process loss and orchestration-environment isolation. Synthetic message and reaction ports verify delivery identity and terminal cleanup. Database tests additionally exercise concurrent reservation and a lost gateway terminal update. All use temporary state and no Feishu messages.

Explicit bounded real-model acceptance:

```bash
npm run verify:assigned-native -- /absolute/path/to/pinned-autoloop --native
```

This uses the existing native Codex identity/configuration for two fixed-text rounds in one new conversation. It consumes native service usage and leaves ordinary native conversation history. It checks exact replies, completed native references, same-thread continuation and absence of tool execution items. It does not establish real-model active steering, approval/rejection, external-side-effect recovery or owner-chat readiness. See [observed evidence](../../../docs/live-acceptance.md).
