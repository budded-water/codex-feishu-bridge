# Pilot handoff and rollback

The migration tools prepare one-host pilot state and manage the runtime admission gate. Keep the private plan, compatible bridge artifacts and bundle together throughout the handoff. The [P1 tasks](../openspec/changes/integrate-feishu-autoloop-handoff/tasks.md) track native interactive acceptance, independent review, service inventory and owner-authorized live acceptance.

## Prepare the private plan

Use the actual legacy bridge configuration and registered pilot project. Select a separate pilot data directory and a fresh bundle directory whose parent already exists. The migration copies completed legacy data into the bundle and pilot transport store. Treat the bundle as private application data because it contains messages, account IDs and native execution references.

```json
{
  "version": 1,
  "bridgeConfig": "/absolute/path/to/bridge.config.json",
  "pilotDirectory": "/absolute/path/to/pilot-state",
  "bundleDirectory": "/absolute/path/to/bundles/handoff-001",
  "botOpenId": "ou_REPLACE_WITH_VERIFIED_BOT",
  "sourceSession": "REPLACE_WITH_BRIDGE_SESSION_ID",
  "workerClosureReference": "REPLACE_WITH_WORKER_AND_SERVICE_INSPECTION_REFERENCE",
  "scope": {
    "installation": "REPLACE_WITH_INSTALLATION",
    "tenant": "REPLACE_WITH_TENANT",
    "operator": "ou_REPLACE_WITH_OPERATOR",
    "chat": "oc_REPLACE_WITH_PILOT_CHAT",
    "projects": { "pilot": "/absolute/path/to/registered/project" },
    "pilot": "pilot",
    "hubInstance": "REPLACE_WITH_HUB_INSTANCE",
    "source": "REPLACE_WITH_SOURCE",
    "rule": "REPLACE_WITH_RULE",
    "agent": "REPLACE_WITH_AGENT",
    "agentUse": "bridge-native"
  }
}
```

The project alias and canonical path must match the bridge configuration. The operator and tenant must satisfy its access policy. `sourceSession` selects an existing bridge session belonging to that operator/chat/project. An explicit null starts a fresh pilot conversation while retaining historical sessions in the copied state. Inspect candidate session IDs and unresolved outcomes locally.

```bash
npm run handoff -- inspect /absolute/path/to/handoff-plan.json
```

The inspected session ID is the bridge mapping ID. Its native thread is shown alongside it. Keep this output with the private deployment records.

## Quiesce and drain

The quiesce-capable legacy entry publishes a private maintenance socket under its state ownership. Run the command against that same state directory.

```bash
npm run handoff -- quiesce /absolute/path/to/legacy-state
npm run handoff -- status /absolute/path/to/legacy-state
```

Quiescing persists across restarts. Existing queued/running work continues. Status, steering, stop, native responses and cleanup remain available. New task messages receive a maintenance reply and a retained receipt. After reopening admission, a fresh message authorizes new work.

Drain queued/running tasks, pending native prompts, clarification, result delivery and reaction cleanup. For an uncertain historical task, inspect its process/native history and actual effects, then record the inspection reference through the local maintenance endpoint.

```bash
npm run handoff -- reconcile /absolute/path/to/legacy-state TASK_ID "Reference to process and effects inspection"
```

The original uncertain outcome remains in history. The reconciliation record supplies migration evidence. Once drained, stop the inventoried legacy service and confirm automatic restart is disabled for the cutover window. Its graceful shutdown records consumer/native-child settlement after closing SQLite. Stop the relevant Hub/Worker services and verify their state before recording `workerClosureReference`. These service actions belong to the approved deployment manifest.

## Stage the handoff

```bash
npm run handoff -- stage /absolute/path/to/handoff-plan.json
```

The command acquires the shared legacy state lock, validates its closure receipt and drainage, copies/checksums the closed database, verifies ownership and imports the chosen conversation. It prepares the pilot under a temporary directory and commits the pilot role after the import is ready. Admission starts quiesced. Repeating the same plan retrieves or finishes the retained operation. A completed rollback is retained as that operation’s final state. A plan with different scope or a modified baseline requires investigation of the retained bundle.

Both runtime entries use the same ownership root. The ordinary entry requires the legacy role. The pilot entry requires the pilot role, exact prepared data directory and matching import identities in both databases. This also constrains a stale local service restart.

The prepared pilot entry uses the existing private HANDOFF_CONFIG format with `stateDirectory`, `bridgeConfig`, `hubUrl` and `scope`. Its `bridgeConfig` must name the active BRIDGE_CONFIG file. Configure HANDOFF_SOURCE_KEY and HANDOFF_RUNNER for the pinned Worker as described in the [P1 entry documentation](../openspec/changes/integrate-feishu-autoloop-handoff/README.md). During an authorized activation, the pilot startup command is `npm start -- handoff`. It verifies the actual bot identity, reconciles native owners and connects the gateway under the shared root lock. The local maintenance `resume` command opens admission after the approved acceptance.

```bash
npm run handoff -- resume /absolute/path/to/legacy-state
```

The maintenance root stays the legacy state directory for both roles. The pilot stores its data in the prepared pilot directory. The physical root lock and persistent role record coordinate consumer ownership on this host. Other hosts and external service owners remain part of the deployment inventory.

For a lost pilot owner, `status` lists uncertain execution IDs. Inspect the native processes, journal and actual project/external effects before issuing `reconcile` against that same maintenance root with the execution ID and inspection reference. A reachable authenticated native owner prevents reconciliation. The audit identifies the local maintenance capability holder. The original uncertain outcome remains recorded, and subsequent work requires a fresh request. Routine status, steering, stop and native human responses use Feishu.

Authenticated live observations retain native thread/turn/generation references before terminal completion. After owner loss, recovery can also retain the thread/turn from the execution-bound native journal while preserving the uncertain outcome and project guard.

## Roll back either window

Quiesce the active pilot, drain its admitted work and transport cleanup, stop the inventoried services, then run the rollback with the retained private plan.

```bash
npm run handoff -- rollback /absolute/path/to/handoff-plan.json
```

Before new traffic, rollback restores the verified baseline. After new traffic, it first archives the closed pilot state and native journals, then merges new source receipts, control identities, terminal outcomes, conversation pointers, timestamps and delivered reply links into a baseline copy. The replacement SQLite file and legacy role are published under the shared lock. The restored entry starts with admission quiesced.

The legacy entry can then start under the restored role and continue the latest native conversation. Repeated rollback commands return the committed operation. The source and pilot archives retain their checksums for inspection. Pending work, missing final projections, unresolved guards, incompatible protocol bindings or state changes during export require reconciliation before the operation can publish restored state.

The imported conversation becomes the preferred legacy mapping for that owner and canonical directory, including automatic routing and aliases for the same directory. This also supports a deliberately selected older source session. A later explicit `/new` creates and selects a fresh conversation.

SDK messages sent during the consumer transition may require resubmission after the maintenance window. The bot's receipt and deduplication guarantees apply to durably admitted messages. The [acceptance record](live-acceptance.md) lists the executed fixture rehearsals and the observed owner-private activation/recovery and remaining live-family limits.

## Owner-private recovery control

The [P2 recovery change](../openspec/changes/enable-feishu-inspected-recovery/design.md) provides a narrower Feishu alternative to local reconciliation when a valid sealed native checkpoint is available and no unstarted admitted backlog remains. The original task owner must also be a designated approver in the enrolled private chat and attest inspected command descendants and effects. Recovery preserves maintenance pause, unknown history and blocked requests. It adds no schema tables; its receipt identities use the existing recovery ledger and transport notice tombstones, which the rollback converter already retains. Missing evidence or broader process inspection continues through the local maintenance route above.

Before pilot rollback, committed remote recovery notices must be projected and the outbox must be drained. Graceful gateway closure materializes pending recovery notices; missing projection or undelivered notices prevent conversion. Reopen the pilot to finish delivery before retrying rollback.
