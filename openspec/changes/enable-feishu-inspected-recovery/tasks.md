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
- [x] 3.4 Deploy the reviewed version to the authorized instance and complete bounded owner-chat recovery acceptance; record actual limits.


Required type/behavior/build checks passed with 222 tests. The actual pinned Hub/Worker verifier passed owner-private inspected recovery, receipt deduplication across restart and no native replay, alongside existing interaction/fault cases. Red regressions reproduced missing conversation retention and recovery-notice loss at rollback. The fixes preserve verified native references, project committed notices before closure and reject unprojected/undelivered notices before rollback. All four OpenSpec changes passed strict validation. The corrected complete source passed exact-head CI, preflight and fresh independent review with no actionable findings.

The reviewed locked artifact is deployed on the authorized M6 instance after quiesce/drain, observed shutdown, closed-state backups and managed Feishu readiness. The real owner-private case observed an executing wait, injected only its app-server loss and cleaned captured test descendants. The owner then viewed the exact incident through Feishu and submitted the inspection reference in a fresh Feishu message. One owner-bound recovery decision released the guard while retaining unknown history; the local reconcile command was not used.

A gateway restart retained that decision and its notice tombstone. A fresh no-tool owner turn completed in the original native conversation, now containing twelve turns, with sealed hash/checkpoint/delivery verification and open/drained admission. Bounded official API reconciliation found one recovery-success message and one associated followup reply. The original fault still has one request and one assignment. See [dated acceptance](../../../docs/live-acceptance.md).

All bounded tasks are complete; PR #9 remains open above unmerged PR #8 pending owner merge authorization and later spec synchronization. Human descendant/effect inspection, missing-evidence/backlog maintenance, Hub card maintenance and broader P2 operation retain their separate scope. Test cleanup of one captured descendant and the matching Hub question was performed by the operator, not automatically by the gateway.
