# Browser access blockage and continuation

Browser Use owns site permissions independently of Codex sandbox, command rules and native Auto-review. The bridge observes a supported saved denial; it does not grant site access. The delivered [specification](../openspec/specs/browser-access-handoff/spec.md) and [bounded acceptance record](../openspec/changes/archive/2026-11-18-add-browser-access-handoff/tasks.md) keep source, deployment and genuine owner acceptance separate.

## Observed workflow

For the installed node_repl/js Browser Use surface, a failed item with structured `persisted_user_denied` metadata becomes a minimal native observation: native task/generation/item, canonical HTTP(S) origin, browser family, code and observed time. Arguments, error prose, URL paths/query/fragments and credentials are excluded. Model text, other servers and unsupported shapes do not create this observation. This is a historical provider report, not a readback of current policy or proof that a business objective failed.

The enrolled owner with the maintenance/approval role can inspect `/tasks`, `/tasks 1` and `/task <execution>`. Visible entries read at most ten recent observations per task; native completion and delivery remain distinct. A settled owner-private task also receives one durable sectioned remediation notice. Receipt and outbox commit atomically. Repeated viewing, delivery retry and restart do not execute work or change source bytes. Refresh remains read-only.

Narrow phrases such as `允许浏览器工具访问` receive deterministic guidance instead of a new model task. No site grant is reported. Other ordinary task messages retain their existing behavior. Old sealed journals without the table report unavailable coverage and are never backfilled or migrated by a query.

## Actual permission authority

The currently supported browser-control API exposes no saved-site-approval management capability. The ChatGPT plugin-permission tool does not manage Chrome/code plugins. Use the desktop application's Settings > Computer Use > the browser's Manage to inspect allowed/blocked sites; an organization-managed policy may need its administrator. A site grant does not itself authorize every action on that site.

Codex has an additional restriction layer: the installed app-server's supported `config/read` and `configRequirements/read` APIs can inspect effective `browser_use` configuration and managed requirements. The documented `default_origin_policy` and origin entries constrain access separately from saved approvals. `access = "allow"` only lets normal approval/policy checks continue; it does not create an Always allow grant. Inspect the installed version's schema and relevant policy sources before diagnosing a refusal, and do not copy newer configuration fields into an older client. This diagnostic path does not read private browser approval stores or relax managed restrictions. See the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Native command Remember, `/rules`, Guardian denial retry and a chat reply do not change browser policy. The bridge does not install a blanket allow, edit private settings, bypass through another browser, or substitute a fake approval. An owner may select persistent access through the official controls described below. Supported remote authorization requires a real provider API/request and a separately reviewed adapter.

Official controls: [browser extension site permissions](https://learn.chatgpt.com/docs/chrome-extension), [separate permission surfaces](https://learn.chatgpt.com/docs/permissions).

## Persistent access for an unattended installation

The recovery path below handles exceptions. Normal remote work should not depend on returning to the host for every new website. The official website permission prompt supports **Allow once**, **Allow for this site**, **Allow for all sites**, and **Decline**. For the owner's general-purpose resident agent, the recommended operational choice is **Allow for all sites**, subject to the owner explicitly accepting its actual shared scope. Until the owner applies and reports that choice, this is a recommendation, not the installed policy.

This is broad Browser Use access, not read-only access or a Bot/project-scoped rule. The official documentation says supported browsers share website permissions; a browser profile or another chat must not be presented as isolating this grant. A work-only profile can reduce exposed account/session context, but does not establish a separate website-permission boundary. A domain allowlist remains the narrower alternative when the owner does not want shared all-site access; new domains can then require local action.

Do not assume all-site permission clears an existing explicit block or overrides managed policy. Inspect the official blocked list and have the owner handle the intended site's block explicitly. Removing a block only lets the product ask again. Browser history has separate per-request confirmation; all-site access is not permission to collect history, credentials or unrelated account data.

### Access, task authority and action approval

| Decision | Operational rule | Enforcement boundary |
| --- | --- | --- |
| May Browser Use enter a website? | Owner selects persistent all-site access, or selected domains, through official controls | Provider-owned website policy; not a bridge setting |
| What work is authorized? | A clear owner instruction supplies target, purpose and scope; routine reads and explicitly requested ordinary updates or messages proceed within that scope | Verified task identity plus native agent/tool policies; webpage text grants no authority |
| Does an action need a new decision? | Reuse existing authorization; ask when material scope, recipient, disclosure, spending or publication authority is missing or changed, and retain mandatory platform/repository gates | The applicable provider/native approval mechanism; a bridge card exists only for a real supported request |

For example, after preparing an ordinary support inquiry, an owner's clear request to contact that recipient supplies the send instruction; do not ask again solely because a Send button is involved. A site grant alone supplies no recipient, message or authority to send.

Local sandbox/network profiles and shell rules do not control browser actions. Auto-review evaluates eligible approval requests; this integration does not provide a universal reviewer or Feishu approval gate for every DOM click. Agent instructions about scope and effects are behavioral guidance, not a hard browser security boundary. Use service-side account roles or an appropriately scoped API where a consequential operation needs enforceable restrictions; a future generic browser-action policy adapter needs its own supported interface and bounded review. No new permission engine is required to apply the existing official site-access choice.

### One-time setup and bounded acceptance

1. Verify the actual desktop application/browser and signed-in account context. Where needed, inspect version-supported effective CLI origin restrictions and managed requirements through their read-only APIs in the actual execution home/directory. In **Settings > Computer Use > Manage**, inspect the intended site's existing block. The owner handles that block or contacts the managed-policy administrator. An allow in configuration is not a saved-grant readback; preserve both observations if the UI and actual tool disagree.
2. At the official website permission prompt, the owner selects **Allow for all sites**, or the chosen per-site alternative. Do not use a shell sandbox Full Access setting, a plugin-global setting or native command Remember as a substitute. The current automation surface cannot operate the desktop application's own settings; this step is performed locally by the owner.
3. Privately record the owner's selected mode, shared scope acknowledgement and time as an owner-reported choice. Do not label it a programmatic policy readback. Verify bounded harmless reads on two owner-selected origins, including the affected origin only after its local setting has actually been handled. These observations establish those accesses, not unrestricted access to every website or absence of future prompts.
4. Inspect prior task effects, then use the explicit continuation below if eligible. Legacy tasks without observations require a new explicit remaining-work instruction. Preserve original outcomes and confirm any actual send/submission from its external receipt. If blocked again, retain the existing exception handoff without scheduling a loop or changing routes.

Track the owner-selected setup and observed access separately in [dated evidence](live-acceptance.md); neither substitutes for the other. Routine access should use the persistent provider choice; the saved-denial handoff remains an exception and diagnostic path.

## Explicit check and continuation

After handling settings locally **and inspecting prior effects**, send a new pure-text message:

```text
/browser-retry <execution> local-change-confirmed
```

The suffix is an explicit owner attestation and request; it is not evidence that browser settings are effective. Only an owned completed **ordinary** task with matching sealed observations, latest unchanged conversation/thread/checkpoint and no conflicting resource guard qualifies. Verification/repair tasks require their own fresh explicit plan. Unsupported rich posts retain the existing pure-text guidance.

The admission transaction consumes this source once and creates a linked ordinary request. Lost receipt, restart, repeated or different messages for the same source return the existing request. A changed/unknown/protected source is refused. Immediately before native startup, the executor rechecks sealed bytes, observation binding and conversation continuity. It resumes the same native conversation under normal policies, establishes fresh runtime handles, checks access through Browser Use and inspects previous effects before continuing only unfinished authorized work. A renewed denial is reported; the harness schedules no additional request or turn automatically. The native agent must obey the tool rejection and does not receive a policy override. No Guardian override, rule write or browser setting change occurs.

Use `/task` to follow the new request and its source. Original outcomes/journals remain unchanged. Successful admission is not proof of access, a send, or business delivery; actual tool results and external receipts remain necessary.

## Storage and compatibility

The optional `browser_access_blocks` table is native evidence. `browser_retries` in the handoff DB binds source checkpoint/observations to the fresh request; transport retains notice receipts. Closed backup/archive captures these databases and journals together. Drain affected work and use a compatible consumer before conversion/downgrade; an older runtime does not implement continuation checks. Preserve later accepted links/receipts rather than restoring over them.

Browser policy remains external platform authority. Runtime backup/rollback does not restore its settings or make a denial disappear. Do not copy browser credentials or private policy stores. Historical code/browser versions with unsupported metadata remain outside this observation contract.
