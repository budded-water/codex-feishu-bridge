# Operational readiness and recovery rehearsal

Use this with [operation](operation.md), [handoff/rollback](handoff-migration.md), the private deployment inventory and [dated acceptance](live-acceptance.md). This is a bounded operator runbook, not a new automatic backup/restore service or an authority to replay work.

## Current evidence boundary

| Area | Observed or implemented | Still separate |
| --- | --- | --- |
| Service registration | Actual installed gateway/Hub-Worker definitions match inventory; RunAtLoad and KeepAlive configured | A subsequent host login/reboot exercise |
| Coordinated service restart | Closed capture restored managed SDK/Hub readiness; reviewed repair and findings cutovers also verified genuine owner task/approval/final/history and read-only-query roundtrips respectively, as recorded in [dated acceptance](live-acceptance.md) | Other restart/fault families; restored-consumer activation remains separate |
| Closed backup | Private state, configuration, service definitions, inventory and the current verification fixture/report tree captured together | Scheduled retention, off-host storage and full-machine backup |
| Isolated restore | Copied payload hashes, SQLite integrity/foreign keys, retained native-journal bindings and verification report hashes verified | Activating restored state as the live consumer, or restoring on another host/root |
| Sleep/wake and network | Existing reconnection/guard behavior has source and automated coverage; actual power/service policy inspected | Deliberate real host sleep/wake and connectivity interruption |
| Task recovery | Bounded owner inspection/recovery and scripted Worker/native faults have prior evidence | Automatic descendant/effect cleanup or unexecuted real fault variants |

Configured autostart is not an observed login. SDK readiness is not an owner message roundtrip. An isolated restored database is not a live restoration. Keep these labels separate when recording progress.

For read-only query acceptance, retain the original pre-query ledger/file baseline. Normalize SQLite row representations before comparing serialized snapshots; object prototypes are not stored business facts. Report bounded digest/count mismatches and keep detailed ledgers private instead of dumping transcripts through assertion output. Never refresh a baseline after the action merely to make a comparison pass.

## Private inventory and backup coverage

Before capture, identify the exact installation, root ownership, runtime role, enrolled audience, artifact/configuration pair, managed service labels and source/Hub instance. Use the actual installed definitions and supported maintenance CLI. Keep one operator responsible for the maintenance window.

The private plan must include:

- Admission, transport, legacy/root ownership state and sealed native execution evidence, including SQLite WAL/sidecars needed by the closed snapshot.
- Hub data, rules, configuration and its existing master key. Regenerating that key changes derived credentials and card-link identities.
- Active bridge/handoff configuration, private runtime environment files and actual installed service definitions.
- The evidence inventory and verification reports/assets outside the state database. Admission rows holding local paths do not back up those files. Inventory every selected profile's real project/report location; do not silently assume it is below the state root.
- The candidate/policy source needed to interpret the reports, or an explicit source-retention/reconstruction dependency.
- Pinned runtime/engine artifact references and availability. State-only copies do not install Node, Codex, dependencies, user tools or project engines.

Treat the bundle as private account/task data: private directories and restrictive file permissions, no public repository/upload. Host authentication and configuration outside the inventoried deployment remain external prerequisites; do not infer or copy another machine's login, permissions or history.

## Closed capture

1. Inspect actual admission and Hub state. Quiesce new task admission and require drained execution guards, queued/publication work, controls, prompts, outbox/reactions and unresolved effects. Already admitted work continues while quiesced.
2. Save the intended capture identity, compatible artifacts, original service definitions and current maintenance state. If effects are unknown, inspect them through the existing recovery contract first.
3. Stop only the inventoried services. Observe job removal, settlement of the registered PID/start-time identities and Hub listener closure. Command return or PID existence alone does not establish settlement.
4. Copy the closed inventoried set into a fresh private bundle. Reject unexpected symlinks/special files rather than following them into unreviewed locations. Check each copied file against its closed source bytes and retain a manifest of paths, sizes and hashes. Preserve original stored identities and path references.
5. Restart the same original services under exclusive ownership, confirm actual managed SDK/Hub readiness, recheck drainage and then resume admission. A capture/startup failure needs an inspected disposition; do not restore an older database or replay work to hide it.
6. Perform offline validation separately. The original runtime need not remain down while a disposable copy is checked. An offline validation failure means the backup is not yet accepted; it does not authorize replacing the healthy live state.

Retain the immutable bundle and failed validation attempts. If an outcome is unclear, inspect the actual phase/files/service ownership before retrying.

## Isolated restore validation

Use a new private scratch directory. Start no gateway, Hub, Worker or native executor from the copy.

1. Verify bundle payload hashes; copy to the scratch root and verify every payload file before opening databases. Keep the original bundle immutable. SQLite readers may create/change scratch sidecars; do not confuse those with source mutations.
2. Open copied databases read-only and run integrity and foreign-key checks. Verify retained task/control/decision history and native journal hashes against the corresponding sealed results.
3. Resolve stored original report paths through the captured deployment-root mapping into the scratch tree. Check both report hashes there and retain required report assets. Checking the still-existing original files would not prove restoration.
4. Record the exact backup point, validator/runtime versions, database/report outcomes and exclusions. Do not rewrite stored path/owner bindings merely to make a copied consumer start at a different root.

### Pinned Hub SQL functions

The pinned Hub uses a deterministic `card_hash` expression index. A plain SQLite client can fail integrity checking with `unknown function: card_hash()` even when the bytes are valid. Use the compatible SQLite binding and register the exact pure function from the reviewed upstream revision using the master key from that copied snapshot. Do not substitute a dummy function, skip the index check or generate a new key.

Import only the pure calculation for this offline check. Importing the Hub runtime opens its database and can initialize/migrate views or keys; it is not a read-only validator. Keep key material in the validator process and private snapshot, never terminal output or public evidence.

## Prepared host exercises

These procedures are prepared, not passed. Before a disruptive exercise, identify an idle window, local access/recovery route, the exact scope and already-granted authorization. Login/reboot, sleep and whole-host network interruption can affect other applications and require the corresponding operator window. Do not run them merely because this document exists.

| Exercise | Controlled action | Required observations |
| --- | --- | --- |
| Login/autostart | During an agreed window, perform the actual login/reboot boundary | Inventoried jobs start once under expected identity; actual SDK/Hub readiness; owner `/status` and a bounded fresh request/response; retained conversation and no stale replay |
| Sleep/wake | Begin drained, record the boundary, then have the operator sleep/wake the host | Reconnection or managed restart is observed; inspect retained guards/outbox; owner roundtrip after wake; missing completion evidence never authorizes replay |
| Connectivity loss | Prefer isolated fault tests first; a real host interruption needs local access and its agreed scope | SDK reconnect/terminal-failure behavior and delivery backlog observed; restoration checked through a fresh owner roundtrip; external deduplication-window limits remain explicit |
| Worker loss | Use a separately authorized bounded fixture with exact execution/process identity | Native may outlive Worker loss; retain uncertainty/guard, inspect effects and reconcile before new work; no duplicate inference/write from missing acknowledgements |
| Live restore activation | Prepare a reviewed recovery point and account for every later accepted fact | Exclusive stopped consumer, compatible data/artifacts, supported identity checks and real owner continuation; unavailable reconciliation leaves the operation unactivated |

For a restored snapshot, later receipts, decisions, conversations and deliveries cannot be discarded. Existing legacy/pilot conversion covers its documented paths; it is not a general point-in-time merge tool. If later accepted facts exist, prepare a supported reconciliation/conversion plan instead of copying the old snapshot over them.

## After the exercise

Record configuration, simulation, protocol, actual restart, owner interaction and offline/live restore evidence separately in the private inventory and a sanitized dated acceptance entry. Preserve pending host and business gates. Keep normal task authorization, human effect inspection and publication boundaries intact.
