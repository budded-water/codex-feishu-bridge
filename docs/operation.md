# Local operation

## Foreground

Run `npm run build` followed by `npm start`. Keep the computer awake and connected. Ctrl-C or SIGTERM disconnects Feishu, interrupts active Codex turns, stops the child, and releases local state ownership.

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

SQLite holds deduplication keys, thread mappings, task inputs/statuses, pending outbound text, and a minimal approval audit. The directory uses 0700, the database 0600, and the process a restrictive umask. Gateway credentials are excluded from the Codex subprocess environment.

Approval audits store request IDs, task IDs, methods, and decision-sent or invalidated statuses. They do not prove action execution. Pending RPC requests are in-memory and cannot survive process replacement.

There is no automatic data expiry yet. Stop before managing or deleting state. Database deletion loses mappings and deduplication history. Treat backups as private task data.

Logs cover connection, restart, and delivery state. Raw SDK responses, Codex stderr, shell output, and credentials are not printed. Known gateway/API secrets are redacted from outgoing text, but arbitrary secrets in model content cannot all be identified.

## Delivery and recovery

The outbox preserves chat order and retries with backoff and a stable Feishu UUID. A reply failure never starts another Codex turn. External deduplication is time-limited; long outages can still yield duplicate replies. Exactly-once delivery is not promised.

On restart, queued and running tasks are interrupted rather than replayed. Check actual project or external service state before explicitly continuing possible writes.

## Metrics after live setup

Observe acknowledgment/completion latency, pending delivery age, retry frequency, approval expirations, and Codex restart counts. The initial release has connection logs and `/status`, but no exported dashboard or metric time series.
