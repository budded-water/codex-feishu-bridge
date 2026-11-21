# Owner task progress

The P1 gateway exposes a read-only view over existing ordinary, verification and repair task identities. It is available to the enrolled private owner with the existing maintenance approval role. This adds no scheduler, business backlog or model summarizer. Deployment/client evidence is recorded separately in [live acceptance](live-acceptance.md).

```text
/tasks
/tasks 1
/tasks 2
/task COMPLETE_EXECUTION_UUID
```

## What the view means

The default `/tasks` overview separates active, unstarted and still-guarded unknown counts from history. It shows at most ten outstanding items and three recent historical requests. `/tasks 1` opens complete records, ten per page, with outstanding work prioritized. Inspected historical unknowns without a guard retain their outcome and sort with history. Pages can move as state changes; exact execution IDs remain stable. Foreign/unknown IDs and malformed commands never admit work or disclose another owner's content.

Copied progress queries can arrive as rich posts. Private title-free text-only posts containing exactly one supported `/tasks` or `/task` query use the same read-only route and real message identity. A query mixed with images, links, mentions or other instructions does not enter that route. See [owner image tasks](usage.md#本人私聊图文任务p1-网关) for the ordinary-task entry.

Detail shows the bounded request title, execution state, current-round activity/elapsed time and recent-event age when the authenticated owner supplies them. It also shows non-sensitive pending-prompt tokens, verification status/applicability, repair rounds and history links where available. A connected owner or recent event does not prove model/network health. Missing owners remain unverified; retained phases are not liveness proof. Terminal native evidence is checked without changing its journal; missing legacy timing stays absent.

Native completion, verifier observations, independent review, delivery and publication authorization remain separate. Unknown outcomes retain their guards. Viewing an ordinary task does not select a verification profile. No completion percentage, raw command argument, draft, periodic progress message or additional model inference is generated.

## Mobile detail layout

Fresh detail/refresh renders a short complete topic label, native-state header, one summary and two compact facts before a full-width refresh control. The label uses a bounded leading topic when present; a shortened generic label has an explicit ellipsis. The original request is available in a collapsed section; requests over 2,000 Unicode code points are explicitly marked as a partial preview, with the original Feishu message remaining the full source. No model summarizes titles.

A terminal native record is labelled “本轮已结束”, not business completion. Uncertainty, active owner loss, waits and non-pass observations retain visible warnings. Historical browser denials with a registered continuation show that relationship and keep the old observation; they do not repeat local-settings instructions in the first screen. Request text, browser records, execution/verification details and task metadata expand separately. Each disclosure has a blue title, an explicit right-side chevron that rotates on expansion, padded header and border; a short hint explains that clicking the row expands or collapses details. These are native client interactions with no new callback or inference. Query time remains a snapshot and refresh updates the same confirmed message.

The optional structured layout is transport presentation data. Every nested rendered string is redacted, and its plain-text fallback is regenerated from that same layout. Browser origins are redacted before Markdown escaping; retained sends and patches reapply current-secret redaction to raw and escaped text at delivery. Legacy text-only payloads remain readable; a new refresh can modernize an existing card. Drain pending updates and use a compatible consumer before downgrade; old consumers do not implement structured-layout updates. Presentation changes never modify native/admission outcomes, guards or authority.

## Refresh and interaction

Detail queries create snapshot cards with a refresh button. Only a confirmed delivered message and its exact presentation/owner/chat can refresh it. Refresh queues an ordered patch of the same message; uncertain acknowledgement retries the retained update rather than creating a replacement. The existing SDK callback subscription is reused without new application permissions.

Use the original approval card or the displayed English prompt command for a live approval/question. Quote the detail card for `/steer content` or `/stop`; its confirmed reply association selects the original task, so a historical card cannot stop a newer task. Withdrawal and recovery retain their existing conditions. Cards are snapshots, not subscriptions; controls/prompts are revalidated by their original owners when acted on.

## Observed acceptance

The M6 enrolled owner has received the current-work overview, copied a pure rich-post query for a historical repair task, received its detail card and refreshed that same card. Confirmed transport/callback identity and the original pre-query baseline establish unchanged admission, Hub, task/approval and native/project/report facts with no new execution. The later compact layout and explicit native chevrons also have genuine owner confirmation of visible click cues and clear expand/collapse, plus a verified update of the same historical source card. Its acceptance baseline establishes no new tasks and unchanged admission/Hub/native/policy facts. This is historical owner-private query acceptance; live active-stage, other-client and fault families retain the separate source/automated or pending limits in [live acceptance](live-acceptance.md).

## Persistence and compatibility

Admission owns task identity and grants. The read-only owner-channel operation exposes bounded activity without ordinary snapshot/outbox cleanup. Closed journals remain unchanged. Transport State owns the additive task_views table, optional outbox task_view payload, confirmed platform IDs, query/callback receipts and patch deliveries. These are presentation facts, not accepted tasks.

Receipts and output commit together after reading. Storage failure rolls back the transaction, and failure to retain the fallback cannot poison the query chain. Retry never starts execution. Secrets are redacted before title formatting and from stored/sent card text. Query cards associate messages with tasks without changing execution-feedback timestamps.

Drain card deliveries/updates with compatible tooling before downgrade or ownership conversion. Closed snapshots/archive retain the complete transport database; conversion copies query/callback deduplication and task-message references. Old task cards gain no refresh authority in the legacy runtime. Native source/report assets and host acceptance retain existing [operational boundaries](operational-readiness.md).
