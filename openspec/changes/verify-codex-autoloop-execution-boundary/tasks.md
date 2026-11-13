## 1. Native compatibility baseline

- [x] 1.1 Recheck the selected native executable, generated release constant and current acceptance gaps without reading or copying authentication data.
- [x] 1.2 Review protocol/schema changes, regenerate bindings for the selected release and adapt only affected supported behavior.
- [x] 1.3 Run the repository check and real no-inference protocol smoke; record their scope and any failure.

## 2. Isolated orchestration probe

- [x] 2.1 Pin a reviewed Autoloop source/release and create temporary fixture state with synthetic channel inputs.
- [x] 2.2 Select and document process ownership and local-control topology against the readiness requirements.
- [x] 2.3 Implement the minimal extension using existing public boundaries; keep production routing, listeners and state unchanged.
- [x] 2.4 Correlate assignment, execution, native thread/turn and terminal receipt identities; distinguish accepted submission from completed execution.

## 3. Behavior and uncertainty

- [x] 3.1 Cover same-thread continuation, active steering and ownership/project isolation at the real adapter boundary.
- [x] 3.2 Cover stale/repeated native responses, designated decision actors and invalidation on cancellation or process replacement.
- [x] 3.3 Verify stop settlement and terminal-race behavior without treating cancellation acknowledgement as completion.
- [x] 3.4 Exercise worker/app-server loss and start/completion acknowledgement loss; reconcile before any new attempt and retain unknown outcomes when inconclusive.
- [x] 3.5 Verify that result-delivery retries do not start another native execution.
- [ ] 3.6 Perform only authorized bounded native inference/interaction/recovery acceptance; leave unexecuted cases explicitly pending.

3.1-3.5 use the actual plugin/Hub/Worker with a scripted RPC process plus existing Bridge behavior regressions; native model continuation is also verified. For 3.6, two fixed-text model rounds and stored-history verification passed. Live-model steering, approval/rejection and process-loss acceptance remain pending; scripted interaction/recovery is not live-model evidence. No Feishu test or deployment occurred.

## 4. Evidence and handoff

- [x] 4.1 Run strict OpenSpec validation and required local checks on the completed candidate; run protocol smoke for protocol changes.
- [x] 4.2 Update architecture, implementation status and sanitized acceptance evidence with actual outcomes; preserve deployment gaps.
- [x] 4.3 Record the P0 readiness decision, limitations and exact requirements for the separate P1 production-handoff proposal.

Evidence and conditional P1 handoff requirements are maintained in [the probe document](../../../docs/autoloop-p0.md) and [dated acceptance](../../../docs/live-acceptance.md). Keep this change open while 3.6 remains incomplete.
