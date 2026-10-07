# Team access and approvals

Colleagues can submit private text tasks or @mention the application bot in a group. The bridge remains on the owner's computer and uses its installed Codex identity, projects, skills, and tools.

## Configuration

`src/config.ts` is canonical for accepted fields. Private configuration holds actual IDs and paths; the checked-in example contains placeholders.

| Field | Behavior |
| --- | --- |
| `accessMode` | `tenant` admits user senders only from `allowedTenant`; `allowlist` admits only `allowedUsers`. Defaults to `allowlist`. |
| `allowedTenant` | Required explicit tenant key in tenant mode; also restricts an allowlist when supplied. Never use a wildcard. |
| `allowedUsers` | Distinct application-scoped user open IDs. In tenant mode this retained list does not restrict colleagues. It supplies the default approver list when `approvalUsers` is omitted. |
| `groupContextMessages` | Recent group context count, 0–50; default 0 disables it. Opt-in fetches one page from the 24 hours preceding the trigger. With 0, an explicit quoted reply can fetch just its referenced message. |
| `groupContextImages` | Group reference image attempts, 0–8; default 0 disables downloads. Owner configuration enables 8. Limits and byte budgets come from src/context-limits.ts. |
| `enableGroups` | Enables group text with a verified @mention of this particular bot. Defaults to false for older configurations. |
| `approvalUsers` | User open IDs authorized to accept or reject Codex command/file approval requests. Defaults to `allowedUsers`; in allowlist mode approvers must be listed there. |
| `approvalChat` | Designated chat for command/file approval previews and decisions, normally the owner private bot chat. When omitted, approval stays in the task chat. |
| `projects` | Registered local project aliases available to admitted submitters. Every alias must resolve to an existing absolute directory. |

Group mode requires the published group-mention scope and bot identity access. Existing private configurations retain their allowlist/private-chat defaults. To enable team use, explicitly choose tenant mode, pin its tenant, enable groups, and configure the owner as approver with the owner private approval chat. Enrollment prints the application-scoped owner open ID, tenant, and private chat. It never enrolls everyone as an approver.

## Conversation ownership

Ordinary messages start in discussion mode, not an automatically selected code project. Use `/project <alias>` for code work and `/chat` to return. Discussion replies omit task acknowledgment, start, progress, and completion labels. Local repository rules are never group chat history.

Each user has a separate session per tenant, chat, and project. Two colleagues in one group do not share Codex conversation history. Their work on the same real directory uses one serial queue. `/stop`, `/补充`, `/clear`, and `/new` affect the sender's selected session only.

Group commands also require @mentioning the bot, including `/status`, `/project`, and control commands. Ordinary group discussion, @all, other-bot mentions, and bot senders are ignored. Startup fetches the bot's own open ID; failure prevents group startup rather than guessing identity.

The bridge sends group task output back to that group, where members can read it. Project replies use a small project/number footer to distinguish interleaved results; activity and approval notices retain the request number. Native rich posts render Markdown emphasis, lists, links, and code. Answer drafts are never forwarded as progress. A private task replies in its private chat. Session isolation does not isolate the shared filesystem, host credentials, or installed tools.

## Approval ownership

Codex applies its existing sandbox and approval policy. Operations it already permits can execute without an additional bridge approval; the administrator gate applies when Codex raises an approval request.

An approval preview identifies its task and submitter and is delivered to `approvalChat` when configured. The submitter gets a waiting notice in the originating chat. Only a listed administrator, in the designated chat and task tenant, can decide the live request. Administrators do not need to select the submitter's project/session first. Timeout, process replacement, late decisions, and duplicate decisions cannot authorize an old task.

Single non-sensitive questions remain in the original task chat and can be answered or declined only by that task's submitter. Being an approval administrator does not authorize answering another person's question.

The approval audit stores the deciding actor for human responses. It records a sent protocol decision, not proof that the action executed.

## Live acceptance

Check the application's published availability includes colleagues and add it to the intended group. From two colleague accounts, test @mentions, independent follow-ups, and controls. Check an approval arrives in the owner chat, a submitter decision is rejected, and the owner decision reaches the actual task. Keep external application visibility/scopes synchronized with the local access policy. See live-acceptance.md for observed evidence and remaining acceptance.

## Chat context

Context is prepared only after tenant/user admission and persisted task routing. Commands do not fetch history. Trigger metadata survives queuing; the read is bounded by the original trigger time, so messages arriving afterward are not treated as prior discussion. The recent-history API receives only the originating chat, a 24-hour window, and the configured page size, with no pagination to older records. Deleted messages and ordinary bot chatter are excluded. Returned records are independently checked against the millisecond trigger cutoff and 24-hour lower bound, then the most recent permitted records are presented chronologically.

Context includes text and rich-post text. When separately enabled, admitted standalone and post-embedded images are downloaded by their message ID/resource key and passed as image inputs, with a numbered reference to the original message. PNG/JPEG/GIF/WebP signatures are accepted; arbitrary URLs, attachments, cards and pinned documents are not fetched. Failed, disabled, invalid, or capped images remain explicitly unread. Quoted-message-only mode reads the one referenced message and validates its chat and timestamp. It may include a quoted bot answer; automatic recent history excludes bot messages.

Reference messages are separately labelled JSON, with developer instructions that they cannot authorize tools or approvals. The latest submitter request remains the instruction. If a question refers to prior discussion but the relevant context cannot be obtained, the bot states the limitation without starting a repository task or pretending it read the conversation. If recent history is disabled, users can quote or paste the relevant text.

Fetched context is passed to the installed Codex and its configured model provider; normal Codex transcript storage applies. It is not committed or printed as raw SDK history. Group reading requires published message-read and `im:message.group_msg` scopes and actual bot membership. The platform scope covers all messages in associated groups, while the bridge enforces its narrower trigger/chat/time/count policy; code tests do not establish these external permissions.

Image reading uses the existing message-read scope; no additional platform scope was requested. The download budget limits resource attempts and bytes. Image bytes remain in memory, separate from textual JSON; normal Codex/model image transcript storage still applies. Image content is reference material and cannot authorize commands or approvals.
