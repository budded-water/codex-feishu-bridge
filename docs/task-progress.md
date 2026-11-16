# Owner task progress

The P1 gateway exposes a read-only view over existing ordinary, verification and repair task identities. It is available to the enrolled private owner with the existing maintenance approval role. This adds no scheduler, business backlog or model summarizer. Deployment/client evidence is recorded separately in [live acceptance](live-acceptance.md).

```text
/tasks
/tasks 2
/task COMPLETE_EXECUTION_UUID
```

## What the view means

The list contains ten owned tasks per page in the current canonical workspace/resource. Granted active/unknown tasks come first, then unstarted requests, then recent ended/withdrawn tasks. Pages reflect current records and can move as task state changes; exact execution IDs remain stable. Foreign/unknown IDs and malformed commands never admit work or disclose another owner's content.

Detail shows the bounded request title, execution state, current-round activity/elapsed time and recent-event age when the authenticated owner supplies them. It also shows non-sensitive pending-prompt tokens, verification status/applicability, repair rounds and history links where available. A connected owner or recent event does not prove model/network health. Missing owners remain unverified; retained phases are not liveness proof. Terminal native evidence is checked without changing its journal; missing legacy timing stays absent.

Native completion, verifier observations, independent review, delivery and publication authorization remain separate. Unknown outcomes retain their guards. Viewing an ordinary task does not select a verification profile. No completion percentage, raw command argument, draft, periodic progress message or additional model inference is generated.

## Refresh and interaction

Detail queries create snapshot cards with a refresh button. Only a confirmed delivered message and its exact presentation/owner/chat can refresh it. Refresh queues an ordered patch of the same message; uncertain acknowledgement retries the retained update rather than creating a replacement. The existing SDK callback subscription is reused without new application permissions.

Use the original approval card or the displayed English prompt command for a live approval/question. Quote the detail card for `/steer content` or `/stop`; its confirmed reply association selects the original task, so a historical card cannot stop a newer task. Withdrawal and recovery retain their existing conditions. Cards are snapshots, not subscriptions; controls/prompts are revalidated by their original owners when acted on.

## Persistence and compatibility

Admission owns task identity and grants. The read-only owner-channel operation exposes bounded activity without ordinary snapshot/outbox cleanup. Closed journals remain unchanged. Transport State owns the additive task_views table, optional outbox task_view payload, confirmed platform IDs, query/callback receipts and patch deliveries. These are presentation facts, not accepted tasks.

Receipts and output commit together after reading. Storage failure rolls back the transaction, and failure to retain the fallback cannot poison the query chain. Retry never starts execution. Secrets are redacted before title formatting and from stored/sent card text. Query cards associate messages with tasks without changing execution-feedback timestamps.

Drain card deliveries/updates with compatible tooling before downgrade or ownership conversion. Closed snapshots/archive retain the complete transport database; conversion copies query/callback deduplication and task-message references. Old task cards gain no refresh authority in the legacy runtime. Native source/report assets and host acceptance retain existing [operational boundaries](operational-readiness.md).
