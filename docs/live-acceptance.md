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

## Mention and quote diagnosis

The owner supplied a reply containing unresolved mention placeholders and a quoted follow-up that was interpreted as an unrelated tool error. Private task metadata confirmed placeholder input, an explicit parent reference and enabled recent history. The previous history path omitted parent-message retrieval and filtered bot replies. The fix resolves supplied mention names and independently admits the exact quoted message, with bounded tests. No new Feishu test message was sent; fresh corrected-reply acceptance remains pending.

## Conversational UX acceptance boundary

Durable reply association, concrete-action approvals, scoped natural controls, explicit native mentions and local timing collection are implemented and covered by fictional behavioral tests. No bot activation, approval, member notification or new Feishu test message was performed for these tests. Real reply placement, notification visibility and colleague/admin UX still require acceptance. Metadata/source and service-connectivity evidence do not prove those end-to-end behaviors or faster responses.

## 2026-11-13: isolated Autoloop P0

This evidence belongs to an isolated source checkout and temporary test state, not the running Feishu deployment. The native executable matched the regenerated [release constant](../src/codex/generated/version.ts). The reviewed changes were optional initialization/turn/tool-output fields and an audio input representation; supported text and interactive behavior passed the local type/behavior/build check. The real no-inference stdio/model-catalog/tool-disabled-routing-thread smoke passed outside the filesystem sandbox; its initial sandboxed child start failed and is not counted as a successful handshake.

Using the clean source revision in [source.json](../experiments/autoloop/source.json), the explicit verifier ran the actual Autoloop Hub and Worker with the standalone plugin and a scripted native RPC process. It verified:

- Worker/Hub process loss and restart while the original native turn remained alive, followed by owner steering and completion without another start.
- Started and result acknowledgements lost after Hub acceptance; persisted result delivery retried without native replay.
- A different attempt folder reading the same completed assignment, source-event deduplication, and the next logical round resuming the original thread with a new turn.
- A native command-approval request reaching the synthetic administrator chat; a submitter response had no effect, while the designated administrator's response produced one native decision.
- Interrupt acknowledgement remaining nonterminal until the later native interruption event.
- Native process loss and accepted start without an acknowledgement remaining uncertain; reading either assignment again did not start another native turn.
- Worker cancellation settling its owned process group, with the scripted native PID absent afterward; the native child had no orchestration/control environment secrets.

The normal test suite additionally covered stale/duplicate/expired approvals, process-generation invalidation, owner/chat isolation and shutdown requiring SIGKILL. A submitted but unconfirmed native start is now recorded as unknown even while app-server remains responsive. Shutdown awaits observed native exit.

The explicit native mode then ran two fixed-text model rounds through the pinned Hub/Worker/plugin and actual native app-server. Both produced the exact requested marker, used one thread and distinct turn IDs, and completed successfully. A fresh no-inference `thread/read` of that test conversation confirmed exactly two stored turns and no tool execution items. Authentication/configuration files were neither copied nor changed. This is real model/continuation evidence, not a real native approval, active-model steering or external-side-effect recovery test.

Required local checks, strict OpenSpec validation and the separate no-inference smoke passed for this implementation. No Feishu listener/channel adapter was activated, no test message was sent, and no service or production queue was migrated. The original application checkout remained untouched. Keep live-model interactive/recovery acceptance open, and use the separate P1 handoff requirements in [the probe document](autoloop-p0.md); do not infer production readiness from this result.

## 2026-11-13: P1 routing feasibility

The [P1 handoff design](../openspec/changes/integrate-feishu-autoloop-handoff/design.md) was checked against the same pinned upstream source. The explicit `npm run verify:handoff-routing -- <pinned-checkout>` command started an isolated actual Hub and used its public source/worker/owner HTTP APIs with synthetic records. It did not start a Worker process, native agent, model call, Feishu connection or service installation.

The negative control reproduced coalescing of two distinct events into the default queued lane and inheritance of that lane's completed session. The proposed configuration then verified separate runs for burst requests, source deduplication, retrieval of an existing claim after acknowledgement loss, serial dispatch across aliases sharing a canonical-project group, and independent dispatch for another project. Subject lanes with group concurrency one were sufficient; no per-project agent fleet or kernel patch was required. A deliberately reused lane with resume disabled did not inherit its earlier session. Native owner/conversation lookup remains proposed gateway behavior, not evidence supplied by this Hub test.

The source outcome API also confirmed that an event received during a rule pause is retained as skipped with no assigned run. HTTP acceptance must therefore not be projected as scheduled execution. The proposed gateway contract retains/reconciles this distinction instead of retrying under another event identity.

Both OpenSpec changes passed strict validation. The repository type/behavior/build check and existing P0 scripted Hub/Worker regression passed after sharing the unchanged pin-verification method. Current native protocol and production entry points were unchanged. P0 native interactive/recovery acceptance remains open. P1 gateway admission/guards, control/result delivery, state converters, quiesce tooling and live cutover have not been implemented or activated by this work.

## P1 durable admission component acceptance

The admission slice now uses the existing SDK event normalizer, scoped installation/operator/chat/project records and private SQLite persistence. Tests retained original message content and request/conversation/execution identity across duplicate delivery and reopening. Registered aliases resolved to the same canonical project. Two worker threads opened the same database and competed for separate requests simultaneously, producing one execution permit and one busy result.

The extended pinned-Hub verification connected the component source outbox to an acknowledgement-loss proxy. The proxy forwarded and committed the first source POST, then returned a failure. Assignment admission retried the same opaque event identity, retrieved the existing event, verified its actual claimed run and issued one permit. Reopening the gateway returned the retained execution. The posted payloads contained request metadata while task content stayed in the private store.

With a retained uncertain execution, a queued alias request reached the Hub and was blocked at execution admission. A later alias request was blocked locally. A scoped operator decision recorded settlement/effects inspection evidence, after which a fresh remaining-work request acquired a new permit. A paused source event retained a blocked submission with zero execution permits. Additional database tests verified permit ownership, stale/repeated recovery, conflicting terminal reports and terminal evidence arriving after an initially uncertain outcome.

The complete local type/behavior/build check passed with 166 tests. Both OpenSpec changes passed strict validation. Execution evidence in the new Hub verification was synthetic. Native owner authentication, actual process/journal reconciliation at startup, live controls/results, migration rehearsal and owner-chat activation remain open tasks. Component terminal/recovery APIs currently receive their evidence declarations from the caller, and the next execution slice must supply the authenticated native evidence path.

Linux CI exposed a 30ms wall-clock race in the existing approval expiry/cancellation fixture. The test now advances a controlled clock through expiry and checks the same decline, late-response and cancellation behavior. The complete local suite passed after this correction.

## 2026-11-13: P1 assigned native execution

The [assigned-native verifier](../experiments/autoloop/verify-native.mjs) connects actual pinned Hub/Worker dispatch through a standalone public agent plugin to the retained admission request and one native Bridge/State task. Feishu normalization now belongs to a separate channel adapter; an additive admission migration preserves request IDs and moves the old bot binding into its channel record. No upstream kernel change was made.

Scripted RPC acceptance verified a Worker restart while the native owner remained alive, duplicate steering with one native dispatch, same-thread follow-up, retained checkpoint reuse with no extra start, designated administrator/chat approval ownership and observed interruption. Lost native start acknowledgement, app-server loss and owner-process loss retained uncertain project guards and blocked new work. The actual app-server child environment excluded orchestration variables. Unit tests additionally covered a lost gateway terminal update recovered from the closed journal, child-exit gating, wrong owner token/actor, stale checkpoints protecting newer guards, changed journal evidence, revoked/uncertain launch permits, disabled group access and split project registry rejection. A large final answer did not prevent the bounded owner liveness challenge.

The explicit --native mode completed two fixed P1_NATIVE_OK turns through the actual Hub/Worker and new assignment entry, using the host's existing native Codex identity/configuration. Both eligible final answers were retained, the second execution resumed the same native thread, and a separate native thread/read confirmed exactly two stored turns with no tool execution items. This consumed native service usage and created ordinary native history; no authentication/configuration was copied or changed. This evidence covers bounded native continuation, while real-model active steering, approval/rejection and external-effect recovery remain pending.

The complete local type/behavior/build check passed with 173 tests. Both OpenSpec changes passed strict validation. The no-inference native protocol smoke, existing P0 scripted Hub/Worker verification and admission/routing verification also passed. No Feishu listener, channel connection or service was started by these checks, and no Feishu message was sent. Native final answers remain in the sealed execution State; durable gateway control acknowledgement/result/reaction projection and migration/activation remain open. These results do not close P0's pending native interaction/recovery acceptance or establish a production cutover.

## 2026-11-13: P1 durable controls and human transport projections

The isolated PilotInteractions gateway now consumes normalized messages, retains control identity and native generation/thread/turn before dispatch, and projects native prompts/results into a dedicated transport State. The actual Hub/Worker verifier now drives this gateway with synthetic message/reaction ports. It verified a lost control acknowledgement after native dispatch, gateway reopening with lookup-only outcome recovery, duplicate control/approval suppression, full administrator prompt delivery, original-owner final replies and terminal reaction cleanup. The upstream pin and production listener are unchanged.

The complete local type/behavior/build check passed with 187 tests. New behavior tests exercised actual native/gateway/transport SQLite records and authenticated owner IPC: uncertain acknowledgement with and without a native dispatch record; an RPC still awaiting its native acknowledgement; stale generation/actor/quoted-task rejection; control lookup from a sealed journal; gateway outage during completion; stable final-message UUID across lost transport acknowledgement/reopening; native journal integrity after human delivery; stale prompt suppression before a delayed send; reaction removal retry independent from final answers; source-route blockage; pre-start cancellation; new-owner launch polling, stop/completion races and control dispatch during stalled source publication or human delivery. Import tombstones prevented successful deliveries from being recreated. Previously accepted native effects were never replayed to repair delivery.

The final assigned-native scripted Hub/Worker verification, previous P0 scripted verification, routing/admission verification and no-inference native protocol smoke passed. Explicit real-model mode also passed two fixed P1_NATIVE_OK turns in one conversation and projected both final replies exactly once to the synthetic human transport. Stored native history contained exactly two turns with no tool execution items. Native authentication/configuration was reused without copying or editing it. Real-model active steering, approval/rejection and external-effect recovery remain pending.

Both OpenSpec changes passed strict validation. These are isolated runtime/component results: no Feishu SDK listener, real Feishu message, bot activation, service installation, production scheduling migration or cutover occurred. The production entry point continues to use its existing queue. Exclusive consumer/state ownership, quiesce/export/import, rollback rehearsal, independent final review and live owner-chat acceptance remain in the migration/activation tasks. Steady polling retains a fresh grant whose owner has not yet published; a process lost in that window needs explicit retained-owner recovery and never gains timeout-based replay authority.

## 2026-11-13: Quiesce, closed-state conversion and rollback rehearsals

The persisted maintenance gate and authenticated local endpoint were exercised with temporary databases and a controlled subprocess. Quiescing rejected new task messages durably while existing task controls continued. The shared root lock rejected a second owner. The supported migration CLI staged a pilot import, and the ordinary runtime entry rejected the pilot-owned state before connecting the SDK.

Fixture rehearsals covered both rollback windows. Before traffic, the verified legacy database was restored. After traffic, rollback retained new message/control deduplication, terminal tasks, conversation pointers, timestamps and delivered reply associations. The restored legacy Bridge resumed the latest native thread with a fresh authorized message and ignored already-handled messages. An explicitly fresh pilot conversation became a new legacy session while retaining the historical session. Completed historical records with nullable source fields kept their existing reply links.

Interrupted-publication tests recovered a prepared import, an export awaiting its database copy, and both rollback owner-role publication points. Repeated commands retained their committed outcome, including a completed rollback. Wrong session ownership, changed snapshot bytes, missing prepared databases, protocol/closure mismatch, pending output and unresolved outcomes prevented publishing a new owner. Closed native artifacts were copied into a checksummed private rollback archive.

The complete local type/behavior/build check passed with 200 tests. Both OpenSpec changes passed strict validation. Existing actual Hub/Worker scripted assignment/interaction acceptance, the P0 scripted supervision regression and the no-inference native protocol smoke passed. These rehearsals used synthetic actors and message ports. Real host service shutdown, live bot identity verification, native interactive acceptance, independent final review and the owner-chat cutover remain in the activation tasks.

## 2026-11-13: Migration review recovery and group-context regressions

Independent review of the first migration candidate identified four defects in the managed pilot recovery entry, pre-terminal conversation retention, older-session reverse-conversion lookup and assigned group context. The follow-up adds a supported authenticated maintenance recovery path, early verified native references and bound-journal recovery, preferred imported legacy conversation lookup, and private execution/message-bound reference snapshots through the existing ContextPort contract.

A controlled first-turn owner was killed before any gateway live inspection. Recovery retained its native thread while keeping its outcome uncertain and project guard held. A separately managed pilot subprocess exposed the uncertain execution through status, rejected recovery without an inspection reference, recorded the local operator decision and drained for rollback. A fresh authorized legacy turn then resumed that recovered conversation. An authenticated live owner prevented guard release in a separate regression. Another rollback fixture included a newer historical session and verified that alias lookup continued the deliberately selected older conversation, with explicit new-session selection still available.

Assigned group execution preserved history limits, actor/chat/source scope, cutoff and explicit quotes across gateway restart. Initial and steering image inputs remained separate from reference JSON. Source publication waited for its retained snapshot, stop proceeded during a delayed quote fetch, settled projection retired snapshot bodies, and an uncertain execution retained its snapshot and guard.

The complete local type/behavior/build check passed with 205 tests. Both OpenSpec changes passed strict validation. Actual pinned Hub/Worker scripted assignment/interaction acceptance, previous P0 supervision regression, routing/admission verification and no-inference native protocol smoke passed. The follow-up candidate is subject to exact-head independent review recorded with its PR. Native active steering/approval/rejection/effect-recovery acceptance, private deployment inventory and live owner-chat activation remain in the P1 tasks.
