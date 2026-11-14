## Why

The proposed agent system reuses native Codex for reasoning and Autoloop for orchestration. The current bridge already owns conversation mappings, a queue, live interactions and delivery records. A version mismatch or an unclear assignment boundary would carry existing defects into the new architecture.

Before changing production routing, establish a version-matched native baseline and verify that an isolated Autoloop assignment can drive a real, continuable Codex conversation without losing controls or replaying uncertain work. See the [direction and roadmap](../../../docs/agent-system-plan.md).

Status: implemented as an isolated experimental probe, with scoped acceptance recorded in [the probe documentation](../../../docs/autoloop-p0.md). Subsequent authorized P1 owner-chat tests complete the bounded native interaction/recovery campaign; P1 owns deployment and its dated evidence. This change does not authorize deployment.

## What Changes

- Align generated protocol bindings and adapter behavior with a deliberately selected installed Codex release, retaining native identity and policy.
- Exercise a bounded execution probe through Autoloop's documented extension boundary in isolated state.
- Define and verify assignment identity, native thread/turn identity, receipt semantics, live controls, stale-request handling and uncertain-outcome reconciliation.
- Record the process ownership and local control transport selected by the probe, including how stop and restart settlement work.
- Produce sanitized evidence and an explicit readiness decision for a later production-routing change.

## Capabilities

### New Capabilities

- codex-execution-readiness: acceptance requirements for a version-aligned native executor and its isolated Autoloop boundary.

### Modified Capabilities

None. Existing runtime behavior is documented outside OpenSpec; this first change adds a proposed readiness contract rather than inventing an already-delivered baseline.

## Impact

Expected implementation areas are the Codex adapter, generated bindings, focused behavior tests, a fixture-only orchestration probe and current compatibility/acceptance documentation. Reuse transport, ownership and interaction contracts.

Do not switch the production queue, activate a bot, send Feishu test messages, run project mutations or publish an artifact as part of the default probe. Real inference, native approval exercises or host-operation tests require the corresponding test authorization. This proposal itself authorizes none of those actions.

The acceptance target is a demonstrated integration boundary, not a ready-to-deploy agent platform. P1 production handoff will be a separate change.
