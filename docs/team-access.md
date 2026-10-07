# Team access and approvals

Colleagues can submit private text tasks or @mention the application bot in a group. The bridge remains on the owner's computer and uses its installed Codex identity, projects, skills, and tools.

## Configuration

`src/config.ts` is canonical for accepted fields. Private configuration holds actual IDs and paths; the checked-in example contains placeholders.

| Field | Behavior |
| --- | --- |
| `accessMode` | `tenant` admits user senders only from `allowedTenant`; `allowlist` admits only `allowedUsers`. Defaults to `allowlist`. |
| `allowedTenant` | Required explicit tenant key in tenant mode; also restricts an allowlist when supplied. Never use a wildcard. |
| `allowedUsers` | Distinct application-scoped user open IDs. In tenant mode this retained list does not restrict colleagues. It supplies the default approver list when `approvalUsers` is omitted. |
| `enableGroups` | Enables group text with a verified @mention of this particular bot. Defaults to false for older configurations. |
| `approvalUsers` | User open IDs authorized to accept or reject Codex command/file approval requests. Defaults to `allowedUsers`; in allowlist mode approvers must be listed there. |
| `approvalChat` | Designated chat for command/file approval previews and decisions, normally the owner private bot chat. When omitted, approval stays in the task chat. |
| `projects` | Registered local project aliases available to admitted submitters. Every alias must resolve to an existing absolute directory. |

Group mode requires the published group-mention scope and bot identity access. Existing private configurations retain their allowlist/private-chat defaults. To enable team use, explicitly choose tenant mode, pin its tenant, enable groups, and configure the owner as approver with the owner private approval chat. Enrollment prints the application-scoped owner open ID, tenant, and private chat. It never enrolls everyone as an approver.

## Conversation ownership

Each user has a separate session per tenant, chat, and project. Two colleagues in one group do not share Codex conversation history. Their work on the same real directory uses one serial queue. `/stop`, `/补充`, `/clear`, and `/new` affect the sender's selected session only.

Group commands also require @mentioning the bot, including `/status`, `/project`, and control commands. Ordinary group discussion, @all, other-bot mentions, and bot senders are ignored. Startup fetches the bot's own open ID; failure prevents group startup rather than guessing identity.

The bridge sends group task output back to that group, where members can read it. Task IDs identify interleaved progress and results. A private task replies in its private chat. Session isolation does not isolate the shared filesystem, host credentials, or installed tools.

## Approval ownership

Codex applies its existing sandbox and approval policy. Operations it already permits can execute without an additional bridge approval; the administrator gate applies when Codex raises an approval request.

An approval preview identifies its task and submitter and is delivered to `approvalChat` when configured. The submitter gets a waiting notice in the originating chat. Only a listed administrator, in the designated chat and task tenant, can decide the live request. Administrators do not need to select the submitter's project/session first. Timeout, process replacement, late decisions, and duplicate decisions cannot authorize an old task.

Single non-sensitive questions remain in the original task chat and can be answered or declined only by that task's submitter. Being an approval administrator does not authorize answering another person's question.

The approval audit stores the deciding actor for human responses. It records a sent protocol decision, not proof that the action executed.

## Live acceptance

Check the application's published availability includes colleagues and add it to the intended group. From two colleague accounts, test @mentions, independent follow-ups, and controls. Check an approval arrives in the owner chat, a submitter decision is rejected, and the owner decision reaches the actual task. Keep external application visibility/scopes synchronized with the local access policy. See live-acceptance.md for observed evidence and remaining acceptance.
