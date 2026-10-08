# Live acceptance evidence

This record describes the owner installation. It does not imply that a new installation is already configured. Keep credentials, account identifiers, project paths, and chat transcripts in private local configuration/state only.

## Observed

- A dedicated self-built bot application is enabled and published.
- The developer console shows private-message receive and bot-send scopes as added, and the message-received event is subscribed.
- The official SDK connected; the developer console verified the persistent connection as connected.
- Challenge enrollment received the owner's matching private message and exited successfully.
- The enrolled owner is the designated local approval administrator; team mode pins the owner application tenant and admits its colleagues. Approvals are routed to the owner private bot chat.
- Local configuration and the installed Codex protocol version passed `doctor`.
- The bridge initialized local Codex and connected to Feishu in foreground mode.
- Team routing and approval permissions passed the automated behavior suite, including legacy audit migration.
- The official bot-info API returned a valid application bot identity, and the published version API confirmed the group-mention scope.
- The owner approved the wider `im:message.group_msg` platform scope. The console now shows it as Added and current changes as published. A scoped read succeeded after the grant, returning only aggregate verification status/counts; no chat text was printed or committed.
- The owner authorized installing and activating the local macOS launchd service. The installed definition passed `plutil -lint`; launchd reported it running, the state-lock heartbeat resumed, and startup logged Feishu connection readiness after Codex initialization. Login startup and process restart are configured. A later idle-service SIGTERM exercise logged clean shutdown, a successful launchd restart and renewed Feishu readiness/lock heartbeat; a subsequent login exercise remains pending.

## Background service recovery

After a host restart, the previous foreground bridge was absent and no launchd service was loaded. A later owner request did not appear in local task records. The unused service definition also referenced a removed version-specific Node executable. Recovery regenerated the private definition with the stable Homebrew Node entry point and a PATH containing the installed Codex executable, then installed and loaded the service with owner authorization. The background Node initially waited for macOS Documents-folder access; after the permission wait cleared, the bridge initialized and connected to Feishu. There were no queued/running tasks or pending answers before activation. This verifies background startup and connection, not a fresh model-task round trip or offline message replay.

## Enrollment redelivery regression

The live setup exposed a replay boundary: Feishu redelivered the enrollment message after the identification client disconnected, and the initial task router treated it as ordinary task text. The exact `pair <UUID>` syntax is now reserved and ignored before session selection or task enqueueing. A behavioral regression covers duplicate/redelivered challenges before and during a normal task, while allowing ordinary discussion of enrollment syntax.

A completed turn caused by that redelivery is not counted as the intended bounded task acceptance.

## Discussion-context regression

An owner group question referring to earlier discussion reached Codex with only the @mention text. The default project selection exposed repository guidance, which the answer incorrectly treated as the discussion. The owner supplied a screenshot and reported the irrelevant answer; the specific local task input and final answer confirmed the failure. A separate intended read-only project turn completed, so inference access alone was not the missing capability.

The initial fix defaulted new conversations to neutral discussion and required explicit project selection; the subsequent natural-routing change keeps neutral discussion and permits Codex to select a registered project from a clear user request. It suppresses discussion execution-state replies, and distinguishes group reference material from instructions and local repository rules. Recent context is opt-in and bounded to at most 50 prior messages from the preceding 24 hours. Quoted-message-only context is supported. Missing history and unread media are stated explicitly. Behavioral tests use fictional context; the owner initially authorized 20 records and now authorizes at most 50 records from the preceding 24 hours in the triggering group. Private runtime configuration is set to 50, with image attempts enabled up to 8. The initial count-only scoped API verification returned `230027` (missing permissions). After explicit approval, `im:message.group_msg` was added. The console continued to show current changes as published, and a fresh bounded API read returned success and usable context. The permission took effect without creating a new application version. The later owner screenshot shows a reply referring to real preceding text discussion and rendered bold emphasis, confirming these parts of the round trip. New image-grounded replies still need live acceptance.

## Reply-format regression

The owner screenshot showed raw Markdown emphasis in plain-text replies and duplicated answer content in a project progress message and final message. The transport now sends native rich posts, compresses excess spacing and heading size outside code, and splits long replies with Unicode and fenced-code handling. Project drafts/commentary are accumulated internally instead of sent as progress. A successful project reply has a small identifying footer; interruption/failure does not expose unfinished text as a result. Tests validate payloads and event sequences without sending messages. The later owner screenshot confirms readable paragraphs and bold emphasis. Links, lists, and code rendering still need live acceptance.

## Image-context upgrade

The owner screenshot showed relevant text context but an explicit unread-image limitation. That limitation reflected the previous implementation: resource markers were never downloaded or passed as image input. The owner requested image reading and increased history to 50 records. The bridge now supports separately enabled image downloads, numbered message associations, inline Codex image inputs, and count/byte/time bounds. Public examples and legacy configurations keep downloads disabled. Automated tests use synthetic bytes; a real 50-record scoped read succeeded and returned an admitted image, and a separate ephemeral Codex vision turn accepted that image and correctly described its visible title/page. The image and generated verification answer remain private. No group test message was sent. This validates image download and model input; a fresh bot reply using combined chat/image context still needs live acceptance.

## Business-data query context

An owner product-statistics request reached a neutral discussion thread. Codex attempted an analytics-account listing without a verified product data source; the tool returned a rejection while the bridge reported an unsupported interaction. The deployment had no registered alias for the requested product. The follow-up registers that project privately and adds project-specific query guidance referencing its live infrastructure and data model. A separate bounded read-only AWS verification completed registration and recorded-activity aggregation with full pagination, returning only aggregate results. It did not read conversation, image or health content. Private credentials, target preferences, resource mappings and numeric results are excluded from this public record. The checked bridge build and expanded private project registry were loaded with an idle-service graceful restart; Feishu readiness and the lock heartbeat resumed. This verifies the data-query path directly and updated service startup; a fresh naturally routed bot query and the quieter message UX remain pending.

## Pending

- Links, lists, and fenced-code rendering in the actual Feishu client; paragraphs and bold are observed.

- Published colleague availability and a colleague-account @mention/status round trip. Owner group membership and @mention delivery are observed; they do not establish every colleague's access.
- Relevant group discussion using quoted/recent context and direct answers without task noise; runtime scope, wider platform permission approval, and successful API access are verified; text grounding is observed, while relevance of a fresh image-grounded answer remains pending.
- Context continuation, new sessions, project switching, steering, interruption, and queue controls.
- Rejected and explicitly approved colleague actions routed through the owner approval chat under the actual local Codex policy.
- Restart/reconnection exercises and delivery recovery without task replay.
- A subsequent login exercise for the installed service, plus a fresh task round trip through the background instance.

Automated behavior checks and the no-inference protocol smoke test are separate evidence. A connected socket and enrollment message do not prove model access or outbound result delivery.

## Received feedback

Native `OnIt` received reactions, explicit queue feedback and richer `/status` are implemented. The later UX change removes routine timed stage notices and standalone unsupported-interaction messages; their details remain available on demand. Reaction intent/IDs are persisted for late-add and restart cleanup; retries never rerun Codex. Behavioral tests cover deduplication, authorization, long context reads, queued work, approval waits, process loss, ambiguous add responses, deletion retry, restart recovery, stale notice suppression and independent answer delivery. The developer console currently shows reaction-write/read scopes Added and current changes published. A real application-identity check added `OnIt` to an existing owner request, looked up this app’s reaction, deleted it and verified absence, without sending new chat messages. The foreground feedback build connected successfully; fresh bot-message UX acceptance remains pending.

## Natural routing verification

A real local model verification using fictional inputs selected the named registered alias, asked one clarification for an ambiguous data request, and routed ordinary conversation to the persistent neutral discussion thread. No tool requests or Feishu messages occurred. The no-inference protocol smoke also created a read-only, tool-disabled routing thread successfully. These checks verify local routing behavior, not the accuracy of a fresh business-data query or end-to-end bot UX.

The natural-routing build was loaded after confirming no running/queued tasks, pending deliveries or approvals. A graceful SIGTERM logged clean shutdown, launchd restarted the process, Feishu readiness resumed, and SQLite contained the additive routing/task migrations. Fresh bot-message UX and naturally routed business-query acceptance remain pending.

## Bot reasoning effort deployment

On 2026-10-08 (Asia/Shanghai), the owner requested low reasoning effort for this bot independently of other Codex sessions. The private deployment configuration was set to low, the current routing checkout was built with the adapter override, and an idle-service graceful restart was performed. The host Codex configuration remained high. Config/protocol doctor and local behavior checks passed; the real stdio/model-catalog smoke passed outside the sandbox without inference. No Feishu test message or low-effort inference was initiated, so an end-to-end low-effort turn remains unverified. Public templates remain null and do not encode this private deployment preference.
