## 1. Contract

- [x] 1.1 Define exact owner selection, no-launch race, retained audit and independent process-cleanup boundary.
- [x] 1.2 Define notice/restart/rollback and queue-count behavior.

## 2. Implementation

- [x] 2.1 Add atomic withdrawal ledger and reserve/message-purpose invariants.
- [x] 2.2 Add authorized bounded queue view and exact withdrawal controls.
- [x] 2.3 Project durable notices/terminal feedback and preserve rollback/deduplication.
- [x] 2.4 Cover actual database, source interleaving, ownership and restart/migration boundaries.

## 3. Verification and delivery

- [x] 3.1 Pass required checks, pinned integration verification and strict OpenSpec validation.
- [ ] 3.2 Publish dependent PR with current-head CI/preflight and complete-source independent review.
- [ ] 3.3 Deploy reviewed artifact and record bounded owner-private queue/withdrawal acceptance.

Full local type/behavior/build checks passed with 243 tests. Review/publication, pinned integration and actual deployment/live evidence remain separately tracked in section 3.

The actual pinned Hub/Worker verifier passed an already queued source run withdrawn during another native turn, restart/receipt deduplication, no additional native start and a known nothing outcome without an uncertainty card. Existing control, approval, recovery and fault cases also passed. All six OpenSpec changes passed strict validation; relative links and public-content hygiene passed. Native protocol/client bindings are unchanged.
