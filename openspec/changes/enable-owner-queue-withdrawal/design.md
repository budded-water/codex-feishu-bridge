# Design

## Authority and selection

The enrolled owner must also satisfy the existing approval-role/private-chat boundary. `/队列` reads owned requests without an execution or withdrawal. Its bounded list exposes execution references, receipt time and scheduling/block state, without task text, commands, credentials or paths. `/撤回 <execution>` selects one exact request; bare `/撤回` requires a quote of that owner's original admitted message. A conflicting quote, malformed selector, foreign request or unsupported input cannot change state. No fuzzy intent or bulk cancellation is added.

## Transaction and scheduling race

A withdrawal ledger in the existing admission database retains origin, request, actor, previous request/submission block reasons and creation time. A single immediate transaction checks current owner/project, absence of any execution, and message-purpose conflicts; it then writes the receipt and marks the request/submission blocked with the canonical owner-withdrawn reason. Original request, source event and assignment history remain retained. A replay cannot create a new request or another withdrawal.

Reservation checks the committed block under its existing immediate transaction. If reservation commits first, withdrawal refuses even if native startup has not yet happened. If withdrawal commits first, no later reservation may issue a permit. In-flight publication/inspection can still finish and a Hub run may exist or end; the gateway promises no future native launch for the withdrawn request, not Hub cancellation. A late route response must not undo the block.

## Projection and lifecycle

The transport projects withdrawn requests as interrupted unstarted work, allowing existing received-reaction cleanup. A stable `withdrawn` notice tombstone binds the success reply to the deciding owner message. Startup/poll/closure repairs only notice projection, never execution. Duplicate delivery retries the same notice identity. Rollback requires every committed owner withdrawal notice projected and delivery drained, preserves the complete pilot ledger archive and imports command identities as seen. Queue/report counts exclude withdrawn history from waiting/blocked work.

Withdrawal does not release guards, stop processes, alter native evidence, resume maintenance, retry another request, resolve Hub cards or authorize business-side effects. A fresh request is needed for future work. Process cleanup is deferred until a stable execution-owned control mechanism is implemented; sampled diagnostic identities are not promoted to kill authority.
