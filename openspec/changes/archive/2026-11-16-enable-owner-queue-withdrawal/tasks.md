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
- [x] 3.2 Publish dependent PR with current-head CI/preflight and complete-source independent review.
- [x] 3.3 Deploy reviewed artifact and record bounded owner-private queue/withdrawal acceptance.

Full local type/behavior/build checks passed with 249 tests. Review/publication, pinned integration and actual deployment/live evidence remain separately tracked in section 3.

The actual pinned Hub/Worker verifier passed an already queued source run withdrawn during another native turn, restart/receipt deduplication, no additional native start and a known nothing outcome without an uncertainty card. Existing control, approval, recovery and fault cases also passed. All six OpenSpec changes passed strict validation; relative links and public-content hygiene passed. Native protocol/client bindings are unchanged.

Initial independent review identified a source-confirmation failure race after withdrawal: the request could remain unstarted but emit a false native-uncertainty question. Held POST/GET regressions reproduced unavailable, invalid-route and wrong-state responses. The source catch path now rechecks the committed withdrawal before reporting failure. Corrected full checks passed with 249 tests; fresh candidate review/CI and actual rollout remain separate.

The corrected complete source passed fresh independent review with no actionable findings, exact-head CI/preflight and a separate locked build/doctor. Its immutable artifact is deployed to M6 after quiesce/drain, observed shutdown, closed-state snapshots and managed Feishu readiness. Admission reopened empty. At that deployment, task 3.3 remained open for actual owner-private acceptance; the later campaign below closes it. The uncorrected artifact was never activated.

The later reviewed card runtime completed real M6 owner-private English queue view and exact-ID withdrawal. A short sleep-based attempt missed its human-operation window and is not counted as a withdrawal success. A fresh Hub-only campaign retained an unstarted request until the owner viewed and withdrew it. One actual decision and platform success reply persisted; exact Worker configuration was restored, the Hub run ended as nothing, and no native execution/folder or false uncertainty question appeared. Gateway restart retained the decision/notice, followed by an empty queue and fresh same-thread no-tool continuation. This completes task 3.3 for that bounded flow. Quoted withdrawal and withdrawal of queued work while another native task runs retain automated coverage only; groups/colleagues and universal deployments remain separate. See docs/live-acceptance.md for the dated evidence; private records are not published.
