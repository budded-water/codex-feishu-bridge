# Local operation

First-time setup: [installation](installation.md). Field semantics: [configuration](configuration.md). Fault lookup: [troubleshooting](troubleshooting.md).

## Foreground

Run `npm run build` followed by `npm start`. Keep the computer awake and connected. Startup waits up to 30 seconds for actual Feishu SDK readiness; each underlying WebSocket negotiation has its own 10-second watchdog. Closing during Codex executable verification invalidates that pending start so it cannot launch a subprocess after shutdown. Terminal startup errors fail setup; a terminal error after connection stops the bridge with failure status and releases the state lock. Retryable disconnects continue through SDK reconnects. Ctrl-C or SIGTERM disconnects Feishu, interrupts active Codex turns, stops the child, and releases local state ownership.

One bridge process may own a state directory at a time. A heartbeat lock prevents duplicate execution. After an unclean exit, the lock becomes stale after approximately ten seconds. Never delete a live process's lock to force a second instance.

On Codex exit, active tasks become outcome unknown and queued work is cancelled. Codex is restarted with bounded backoff; after the retry budget is exhausted, correct the installation and restart the bridge. A healthy process resets the budget after a minute.

Submissions while Codex is unavailable receive a retry-later reply and are not queued. Work may finish while Feishu is disconnected; its result remains in the outbox.

## macOS service

The generator prints a launchd plist using your local Node executable, working directory, and PATH. It does not install or activate a service.

After private configuration and foreground live acceptance succeed:

```bash
npm run build
mkdir -p .local
npm run --silent service:print > .local/dev.codex-feishu-bridge.plist
plutil -lint .local/dev.codex-feishu-bridge.plist
```

Review the file locally. It references `.env` and the compiled entry point without embedding secret values. Install it yourself:

```bash
mkdir -p ~/Library/LaunchAgents
cp .local/dev.codex-feishu-bridge.plist ~/Library/LaunchAgents/
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/dev.codex-feishu-bridge.plist
```

Stop and unload before using the same state in a foreground instance:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/dev.codex-feishu-bridge.plist
```

Regenerate after moving the checkout or changing executable paths. Logs remain in the ignored `.local` directory. A service does not keep a sleeping computer awake.

## Data and diagnostics

SQLite holds deduplication keys, thread mappings, task inputs/statuses, pending outbound Markdown, and a minimal approval audit. The directory uses 0700, the database 0600, and the process a restrictive umask. Gateway credentials are excluded from the Codex subprocess environment.

Approval audits store request IDs, task IDs, methods, deciding actor IDs, and decision-sent or invalidated statuses. Queued tasks also retain trigger ID, chat type, timestamp, and quoted parent ID for bounded context preparation. Existing task tables gain a nullable source column without changing prior inputs. Existing audit tables are migrated in place to add nullable actor IDs; existing rows and session mappings are retained. They do not prove action execution. Pending RPC requests are in-memory and cannot survive process replacement.

Reference image bytes are streamed into bounded memory and passed as inline inputs; the bridge does not persist downloaded image files or put base64 into the SQLite outbox. Codex/model transcript storage may retain image inputs. Canonical caps are in src/context-limits.ts. Downloads stop starting new resources after their time budget; an in-flight request can finish under the SDK timeout.

The prepared pilot gateway saves bounded group reference snapshots, including admitted inline image inputs, in its private admission database before publication or quoted steering. The assigned process reads these snapshots through the existing ContextPort contract. Sealed terminal projection retires snapshot bodies and retains message/execution identity for deduplication. Uncertain executions retain their snapshots for inspection. Include this database in the private application-data handling described in the migration guide.

There is no automatic data expiry yet. Stop before managing or deleting state. Database deletion loses mappings and deduplication history. Treat backups as private task data.

Logs cover connection, restart, and delivery state. Raw SDK responses, Codex stderr, shell output, and credentials are not printed. Known gateway/API secrets are redacted from complete new outbound text before chunk splitting and persistence, including task-status notices. Delivery also retains per-chunk redaction for older queued records containing a complete known secret; it cannot repair secret fragments split across legacy records. This does not scrub task inputs or Codex transcripts, and arbitrary secrets in model content cannot all be identified.

## Delivery and recovery

The outbox stores Markdown chunks, preserves chat order, and retries each chunk with backoff and a stable Feishu UUID. The transport converts each stored chunk to a native rich post only when sending; old unsent text records use the same conversion without losing their IDs. Code fences are closed and reopened across newly queued parts. Exceptionally long individual lines split at Unicode character boundaries, so complex inline formatting spanning such a boundary may not render intact. Each selected task-status notice is revalidated immediately before its HTTP send, so a task that finishes while another chat is waiting cannot emit an unsent stale notice. An HTTP send already in flight cannot be recalled. A reply failure never starts another Codex turn. External deduplication is time-limited; long outages can still yield duplicate replies. Exactly-once delivery is not promised.

On restart, queued and running tasks are interrupted rather than replayed. Check actual project or external service state before explicitly continuing possible writes.

## Metrics after live setup

Observe acknowledgment/completion latency, pending delivery age, retry frequency, approval expirations, and Codex restart counts. The runtime has received reactions, quiet waiting, connection logs and `/status` with active stage/event age, but no exported dashboard or metric time series. Track reaction failures/cleanup backlog alongside answer delivery latency. A live process is not proof of model/network health.

## Pilot migration maintenance

The local `npm run handoff` commands inspect session IDs, quiesce admission, report drainage and prepare closed-state migration or rollback. Both managed runtime entries validate the shared consumer ownership root. Follow [the migration guide](handoff-migration.md) and the private deployment manifest when operating the pilot.

## Routing-mode updates

Drain current work and retain a compatible artifact/configuration pair before changing routing mode. A retained migration plan hashes the parsed bridge configuration. Preserve an equivalent frozen configuration snapshot for that plan, verify it against the original backup identity, and point the plan at that snapshot before changing the active configuration. The runtime handoff configuration continues to reference the active bridge configuration. Record the effective artifact, mode and recovery pair in the private deployment manifest.

## Inspected recovery through the pilot gateway

The P2 pilot command `/恢复` exposes only the enrolled owner's unknown guarded execution, and only in the enrolled private approval chat when that owner is also a configured approval administrator. `/恢复 <execution-id> <inspection-reference>` requires the exact current guard, a request-bound sealed checkpoint with native-child settlement, an unreachable authenticated owner and the human's process/effects inspection reference. Missing or mutated evidence and unstarted admitted backlog require local maintenance. No new configuration fields, keys or model calls are involved.

The human attestation covers command descendants and file/external effects; native-child settlement alone does not establish those facts. Recovery records the deciding message/owner and checkpoint reference in the existing ledger, releases exactly one guard and retains the unknown outcome. Maintenance pause and blocked requests remain unchanged. The original permit cannot launch again. Hub reconciliation cards remain separate and may be closed through supported owner maintenance after inspection; this gateway has no Hub owner capability.

Committed recovery notices are projected idempotently into the durable transport outbox across restart and before gateway closure. Rollback rejects unprojected or undelivered remote recovery notices. A receipt before an uncommitted decision prevents automatic replay; the owner must send a fresh command. This is an optional remote maintenance route, with the existing local CLI retained for incomplete evidence, backlog or broader inspection. See [usage](usage.md) and the [bounded change](../openspec/changes/enable-feishu-inspected-recovery/design.md). Live rollout status belongs in [acceptance](live-acceptance.md).

The recovery-notice rollback check requires the reviewed P2-or-later tools. A code-only downgrade to P1 must first finish all committed P2 recovery notice projection/delivery with the compatible gateway; see the [migration compatibility boundary](handoff-migration.md#owner-private-recovery-control).
