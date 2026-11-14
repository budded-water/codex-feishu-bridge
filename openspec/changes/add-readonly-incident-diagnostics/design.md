## Native process observations

The native owner obtains its child PID from the local stdio client, without changing app-server protocol calls. Before kicking the task, and at a bounded interval while it runs, a fixed system process query reads only PID, parent PID, state and start time. No shell interpolation, command lines or environment are collected.

A private atomic sidecar binds observations to the existing execution/request binding. It records owner/native identities and observed descendants with parent identity edges, within the canonical process-observer limit. Identity includes PID and OS start-time text. A changed identity is unverified and never treated as the registered process. This is read-only diagnostic identity, not authority for future process killing; time granularity and sampling do not prove complete descendant coverage.

Follow only the registered native process and already observed matching descendants. Never traverse other children of the owner/gateway. Retain observations across reparenting, await the in-flight observer and a final bounded sample before publishing terminal evidence, and stop observation after closure. Observation failure cannot authorize recovery or stop normal execution. Legacy/missing/malformed/cross-binding sidecars are unverified. The optional sidecar and atomic-write remnants are retained by compatible migration tools.

## Report boundary

The existing recovery gateway performs its owner/private-chat/approval-role checks before any observation. It selects only held unknown incidents for that conversation. Native diagnostics validate owner identity and sealed evidence without calling snapshot application, recovery, admission writes or inference. The view does not preserve conversation references; the existing confirmation path still does that after revalidation.

Use the existing source capability only for `GET` of the retained event. Verify expected route/run and actual assignment identity before displaying its enumerated scheduler state. Missing publication, malformed/mismatched state or connection failure is unverified. Do not publish/retry events, change route state, query another source or grant Hub owner capability. Scheduler `done` is not a verified native outcome. Hub cards remain separately maintained.

Queue and transport counts are scoped to the single-owner pilot instance and labeled as counts, not readiness guarantees. The report includes an observation time, registered-process coverage and explicit unverified business effects. It displays no raw requests, commands, credentials, paths or native IPC descriptors. The exact incident ID and permitted process IDs are operational references in the enrolled private chat.

## Lifecycle and authority

Normal deduplicated maintenance receipts and durable outbox projection remain allowed. Diagnostic collection does not change task outcome, conversation pointers, guard, pause, queue or Hub state. The returned report is a snapshot; a later confirmation independently rechecks existing conditions and still requires a fresh human inspection reference. A missing report never relaxes those checks.

## Verification

Use actual owned child processes and SQLite/IPC fixtures for identity changes, reparented observed descendants, unrelated process exclusion, unavailable sampling, legacy/corrupt metadata, read-only collection and restart/archive retention. Use a bounded HTTP server and the actual pinned Hub/Worker verifier to prove GET-only source diagnostics and unchanged publication/assignment identity. Inspect report privacy and authorization. Require full checks, independent review, exact-head CI and a separately recorded authorized owner-chat deployment acceptance.
