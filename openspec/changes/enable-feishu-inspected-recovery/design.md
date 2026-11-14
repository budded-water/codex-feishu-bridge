## Boundary

Recovery is an authenticated human maintenance control, outside native inference and Autoloop assignment. The gateway accepts it before ordinary task routing. Only the configured pilot owner in its enrolled `p2p` chat can use it, and that owner must also be admitted by the configured approval-user/approval-chat policy. An approval administrator acting for a different task owner is insufficient. Unsupported messages, groups and oversize commands cannot recover work.

## Selection and evidence

`/恢复` shows only held unknown executions for that owner/conversation. It reports whether a request-bound sealed checkpoint is available and gives the exact immutable execution ID. The prompt requires the owner to verify command descendants and actual file/external effects before sending an inspection reference. It does not display task input, raw tool arguments, private paths or credentials.

`/恢复 <execution-id> <inspection-reference>` rechecks the exact held unknown execution, ownership, authenticated owner availability and the sealed checkpoint. A reachable owner, missing/mutated checkpoint or absent guard fails closed. The machine proves only native-child settlement and checkpoint integrity. The inspection reference is a human attestation, not independent proof of descendant/external-effect settlement.

An immutable execution ID replaces a transient approval token: this is a fresh maintenance decision about one retained incident, not a response to an expired native request. A previous execution's ID cannot address a newer guard. The recovery ledger stores the original source-message identity, deciding owner and checkpoint-bound inspection reference. A guard check inside the recovery transaction prevents concurrent local/remote confirmations from recording a second decision after the guard is gone. Duplicate completed recovery messages cannot execute again.

## Delivery and lifecycle

The existing transport State deduplicates received maintenance commands before asynchronous inspection. A crash before a decision commits leaves the guard held and requires a fresh command; pending recovery commands are not replayed. A committed recovery is authoritative even if its response is lost. Periodic and pre-closure projection repair the success notice from the recovery ledger into the existing durable outbox using retained notice tombstones. It neither mutates a sealed journal nor reexecutes the task. Rollback rejects a committed remote recovery without its notice projection and requires the outbox to drain before conversion. Source receipt identities remain preserved by the existing rollback converter.

Recovery does not cancel maintenance pause, unblock previously blocked requests, grant a new native permit, change unknown to success or issue a Hub card answer. Previously authorized queued work follows existing admission rules; the gateway refuses this remote operation while other unstarted admitted work remains, so guard release cannot unexpectedly dispatch that work. The owner can use local maintenance to inspect/drain such a backlog.

## Verification

Use the actual SQLite stores and native owner IPC with the scripted native child for authorization, lost result delivery, restart, mutation, reachable owner, stale execution/message and new-guard races. Verify that native start/steer/approval calls do not occur during recovery. Retain complete required checks, current-head independent review and a separately recorded owner-authorized live deployment acceptance. Do not treat scripted evidence as live-model acceptance.
