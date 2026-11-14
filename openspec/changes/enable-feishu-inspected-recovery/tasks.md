## 1. Contract

- [x] 1.1 Inspect current recovery, ownership, transport and M6 acceptance boundaries.
- [x] 1.2 Specify owner-private inspection, exact evidence-backed release and delivery/restart semantics.

## 2. Implementation

- [x] 2.1 Implement recovery inspection and confirmation without inference, replay or extra credentials.
- [x] 2.2 Preserve atomic guard/decision identity and repair success delivery from the recovery ledger.
- [x] 2.3 Add boundary regressions for authorization, evidence, backlog, duplicates, restart and stale guard safety.
- [x] 2.4 Synchronize current architecture, usage, maintenance and implementation status.

## 3. Verification and delivery

- [x] 3.1 Pass focused/required checks and strict OpenSpec validation.
- [x] 3.2 Obtain independent review of the complete candidate and resolve findings.
- [x] 3.3 Publish a separate dependent PR, verify CI and retain the owner merge boundary.
- [ ] 3.4 Deploy the reviewed version to the authorized instance and complete bounded owner-chat recovery acceptance; record actual limits.

Required type/behavior/build checks passed with 222 tests. The actual pinned Hub/Worker verifier passed owner-private inspected recovery, receipt deduplication across restart and no native replay, alongside its existing interaction/fault cases. A red regression reproduced missing conversation retention when the checkpoint arrived before any admission snapshot; recovery now retains verified native references before guard release. All four OpenSpec changes passed strict validation. Independent review, dependent-PR CI and live rollout remain pending.

The initial independent review identified an unprojected recovery notice being lost on rollback. Closure now materializes committed notices, and rollback checks projection plus drained delivery. New closure/rollback regressions failed before the fix and pass afterward. Fresh complete-candidate review remains required.

The corrected complete PR candidate passed exact-head CI, preflight and fresh independent review with no actionable findings. A locked versioned artifact passed build/doctor and is deployed on M6 after quiesce/drain, observed shutdown, closed-state backups and managed Feishu readiness. Admission is open/drained. Task 3.4 remains open for real owner-chat confirmation and fresh continuation.
