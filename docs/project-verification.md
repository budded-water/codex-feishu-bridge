# Task-bound project verification

The P1 handoff entry implements optional project verification. Deployment and real owner acceptance are separate facts in [live acceptance](live-acceptance.md). Ordinary tasks retain their existing native execution behavior.

## Private owner workflow

An enrolled owner who also satisfies the approval-role/private-chat boundary can submit:

```text
/verify example Implement the requested change in this profile's project
/verification COMPLETE_EXECUTION_ID
```

This creates a new native task, not a verification of an arbitrary historical report. The original message is retained and the trusted project's target accompanies the task. Selection does not switch the workspace globally. Codex retains its local model subscription, tools and native approvals. After a completed turn, its execution-ID owner invokes verification before sealing its checkpoint. The existing Worker assignment and workspace guard stay occupied, preventing subsequent harness tasks from changing source during capture. External host writers are not isolated; engine source checks still apply.

During verification `/status` describes its phase and `/stop` requests supported signal cleanup. An incomplete native turn skips verification. Duplicate input, gateway restart, status lookup and delivery retries cannot authorize another invocation. `/verify` never starts a repair turn.

A separate [bounded repair entry](bounded-repair.md) implements explicit `/verify-repair` opt-in with at most one additional native turn. It uses distinct goal/attempt records and does not change ordinary verification. Implementation, deployment and actual owner acceptance remain separate facts.

## Trusted configuration

Add `verificationProfiles` to private `HANDOFF_CONFIG`, alongside `scope`, `stateDirectory`, `bridgeConfig` and `hubUrl`. This is not a bridge.config.json field; both ordinary bridge templates retain their defaults. Gateway and Worker must use the same reviewed artifact/configuration.

```json
{
  "verificationProfiles": {
    "example": {
      "projectRoot": "/absolute/path/to/candidate",
      "projectId": "example-web",
      "suite": "smoke",
      "engineRoot": "/absolute/path/to/reviewed-ui-eval",
      "engineRevision": "0000000000000000000000000000000000000000",
      "cliHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "libraryHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "timeoutMs": 120000,
      "policyFiles": {
        "ui-eval/project.json": "0000000000000000000000000000000000000000000000000000000000000000",
        "ui-eval/engine.json": "0000000000000000000000000000000000000000000000000000000000000000",
        "ui-eval/integrations/smoke.json": "0000000000000000000000000000000000000000000000000000000000000000",
        "ui-eval/verification.json": "0000000000000000000000000000000000000000000000000000000000000000",
        "ui-eval/scenarios/home.json": "0000000000000000000000000000000000000000000000000000000000000000",
        "check.mjs": "0000000000000000000000000000000000000000000000000000000000000000"
      }
    }
  }
}
```

Replace every placeholder. Revision means the full reviewed engine commit; hashes are SHA-256 of its built dist/cli.js and dist/index.js. Engine source must be clean and match that revision before/after execution. These hashes cover selected built files, not installed dependency contents. The harness does not clone, install or upgrade dependencies.

The first slice supports Web suites. `policyFiles` pins reviewed project-relative file bytes before and after invocation. The project descriptor, engine pin and selected suite are mandatory; a referenced verification plan must also be pinned. Register scenario/policy and required-check script files defining the mandatory floor. The harness does not discover the project's complete executable dependency graph; completeness of this trusted list is an operator responsibility, and unlisted candidate code still requires independent review. Policy changes require a reviewed profile update. Native work cannot silently replace the registered suite/plan or listed assertions and then report green against the altered floor.

The candidate owns ui-eval/engine.json, suite, verification plan, fixtures, mandatory checks and browser channel. The engine compares its expected pin with the executing checkout. The harness fixes argv to `node ENGINE/dist/cli.js integrate SUITE --project-root ROOT --format json`; chat cannot choose executable code or weaken scope. Profiles/project commands are trusted executable policy running as the host account outside Codex's command-approval sandbox. Selecting a profile explicitly authorizes its registered validation, including prepare/check commands. Register only policies whose effects you accept.

Verification/Git child processes omit `HANDOFF_`, `AGENT_AUTOLOOP_`, `FEISHU_` and `BRIDGE_` runtime variables. Other project settings remain inherited; configure required project identities through project-owned policy rather than reusing bot runtime credentials. This reduces accidental credential propagation and does not isolate same-account filesystem access or change native Codex's environment.

## Persistence and evidence

An additive private verifications table retains execution, profile definition/digest and planned/running/observed/skipped/unknown disposition. Running intent commits before launch. The sealed native report binds the terminal record, separately from native completion. Profile drift cannot substitute another verifier after admission.

The pinned engine's exported validator interprets output. The harness requires observed exit/code agreement, a fresh generated integration directory, canonical JSON equal to stdout and present bounded HTML. It retains both hashes and task/source/suite/engine identity. Output and each report are bounded to 8 MiB. The reviewed Worker outer budget must cover native work, verification and cleanup; its external stop/timeout policy may force termination before the CLI grace, which remains uncertain. A deadline requests SIGTERM; the engine gets up to 95 seconds for its documented cleanup, then forced termination remains unconfirmed. The trusted CLI owns report generation/reconciliation. This is not arbitrary-report import or a sandbox against other host processes of the same account.

Project/engine reports own verification observations; admission/native checkpoints own task association and dispatch; transport owns rendering and acknowledgement. Execution/profile/result hashes associate these ledgers. A separate bounded verification handoff is persisted atomically with the final native checkpoint projection. Native chunks and sealed journals stay unchanged; retry reuses saved transport identities. Retain project JSON/HTML together with source and private association records. A reply is not evidence revalidation.

Pass, candidate failure, needs-review, inconclusive and interrupted outcomes remain distinct. A plan-free pass establishes that suite only. Engine-declared code/UI/release conclusions cover its declared plan. Independent code review, required human visual review and publication authority remain separate. Reports are private local references in this slice, without automatic upload or hosting.

## Uncertainty and freshness

A known prelaunch failure is unverified without starting a child. After possible launch, missing/invalid/mismatched output or incomplete cleanup retains an unknown execution guard. A completed native turn remains separately recorded in the sealed report. Startup queries the owner/checkpoint; missing acknowledgement never relaunches a planned/running intent. Executor loss without a checkpoint also retains protection.

Initial verification uncertainty requires local CLI/descendant/effect inspection and authenticated local maintenance reconciliation. Feishu's native-only recovery contract is not expanded. The existing process sidecar follows Codex descendants and does not establish complete verification-process coverage. Sampled identities grant no termination authority.

`/verification` reads history. Profile drift, changed registered policy bytes (including Git-ignored files), changed Git HEAD or modified report hashes are stale; dirty source has unverified applicability. Unchanged source/reports do not revalidate environment, fixtures or release eligibility. Release Kit retains separately authorized publication and its own revalidation.

A passing Web observation can be registered through [delivery waiting](usage.md#交付等待p1-网关) when strict Git observations before and after the run match its clean commit. Historical reports without these observations remain available through `/verification`. The reference includes the commit and a SHA-256 over the two retained report hashes. Exact owner confirmation admits one ordinary same-thread request. The gateway and Worker reuse the recorded profile, source and report checks before admission and launch. Validation still owns the underlying run and observations.

## WeChat visual receipts

The local operator can queue a separate screenshot receipt for a completed
owner-private ordinary task. The operator reviews the destination execution,
candidate worktree and selected screenshots before invoking the managed command.
The gateway checks the task's sealed projection and private chat, then reads
the selected reports and screenshot bytes under the named candidate root.
This imports evidence from a finished run. Automated WeChat execution,
recording a human pass and publication use separate workflows.

The operator prepares an owner-only (`0600`) local JSON file with:

| Field | Meaning |
| --- | --- |
| `projectRoot` | Canonical absolute path to the clean candidate Git worktree with an HTTPS origin. The normalized origin contributes to the source digest. |
| `projectId`, `commit` | Exact project ID and full candidate commit recorded in each planned report. |
| `reviewFocus` | Brief text describing what the reviewer should inspect in the pictures. |
| `scenes` | One to three entries, each with the WeChat run UUID in `run`, exact `report.json` SHA-256 (hex, no prefix) in `reportSha256`, and a declared `checkpoint` and readable `label`. |
| `pullRequest` | Optional positive integer. The GitHub repository comes from the clean candidate's HTTPS origin. Displayed with the candidate and base when a delivery workflow is configured. |

Invoke `npm run handoff -- visual-receipt <consumer-state-root> <execution-id> <absolute-private-plan>` against the running pilot. The state root identifies the managed consumer. The command returns the delivery ID and registration status. The Feishu app needs image upload and existing message permissions. A confirmed reply becomes another quotation anchor for the same task. A recalled or deleted original message produces terminal `target-unavailable`, visible when the same plan is submitted again.

The Feishu reply separates the automated result, candidate and pending human
review. The first two screenshots appear side by side with their scene names
and assertion counts. A single screenshot or a third screenshot has its own
row. Tap a screenshot to open the original.
The receipt uses Card JSON 2.0 and needs Feishu client 7.20 or later.
Check the reviewing device's version during mobile acceptance.
See [Feishu client compatibility](https://open.feishu.cn/document/feishu-cards/card-json-v2-breaking-changes-release-notes).

## Web screenshot review receipts

The local operator can use the same private `visual-receipt` command to
send candidate screenshots from a completed ordinary task as native Feishu
images. Use the clean candidate worktree, verify that the displayed PR still
points to its recorded commit, and review the screenshots before sending.
Place one to three PNGs (up to 2 MiB each) in the worktree's ignored
`.ui-eval/visual-review/` directory. The `0600` plan keeps the same candidate,
project, review focus and optional PR fields. Set `format` to `web-screenshot`
and replace `scenes` with `screenshots` entries containing a bare PNG `file`,
its exact lowercase hex `sha256`, and a short `label`.

The gateway verifies the candidate, PNG chunk integrity and screenshot hashes,
then sends the images through the existing persistent card outbox. The default
button is **仅确认验收**. Set `merge: true` with a `pullRequest` to request
the single merge button. This requires the repository to have a workflow
registered with `manualRelease: true`. Project checks are evaluated by that
workflow. The operator binds this plan to the original task and verifies its
scope before queueing. Quote the delivered card in the registered owner-private
chat to report problems or request a follow-up.

### Review actions on new receipts

The enrolled private owner and approver can record visual acceptance in the
card. This updates the original message without starting Codex. A quoted reply
continues the original task and includes the card's observed review state.
Existing delivered cards retain their original display and quotation behavior.

With `manualRelease: true`, an eligible card offers one button,
**通过并合并 PR**. Eligibility is an explicitly merge-bound Web plan or an
existing WeChat plan with passing selected scenes and a bound PR. The click
accepts and authorizes the displayed candidate. A conflict is shown on the
same card. Candidate changes require fresh evidence and a new receipt.
After a provider-confirmed merge, the gateway updates the card and queues one
reply asking about deployment or release. Quoting the card or that reply
continues the original task. The question retries within the same 55-minute
Feishu UUID window as visual receipts. On expiry the gateway retains the
unconfirmed delivery separately from the verified merge. A reply asking to
release is a new request under the project's existing publication rules.

Legacy WeChat workflows can offer a separate acceptance choice and a separate
post-merge upload for a configured developer target. Duplicate clicks consult
the retained result. Inspect the provider after an uncertain write before
making a new delivery decision.

Configure the repository workflow in private `HANDOFF_CONFIG`. These are
deployment-owned programs outside the candidate checkout.

```json
{
  "visualReviewWorkflows": {
    "owner/repository": {
      "executable": "/private/workflows/project-delivery",
      "sha256": "<64 lowercase hex digits>",
      "base": "main",
      "manualRelease": true
    }
  }
}
```

The enrolled runtime owner owns the executable, which must be a regular file
at its canonical absolute path with owner-only write mode. The gateway reads
the bytes once, checks their registered digest and runs a private snapshot from
the protected system temporary directory. Use absolute paths for any adapter
dependencies. The snapshot preserves the executable name and content.
`manualRelease: true` is an operator assertion about the verified project
workflow. Register it only when merge can be performed without a deployment,
store submission or release triggered by the merge itself. Check repository
push workflows and other release integrations before enrollment. The legacy
`uploadTarget` identifies a separately approved developer app.
The gateway also rechecks the recorded approver against the current owner
scope and approval configuration before launch, including after restart.
The program receives a single JSON argument with `id`, `action` (`merge` or
`upload`), `repository`, `commit` (full reviewed commit), `pullRequest` and
`base`. A single-button adapter must require `action: "merge"` and
`manualRelease: true` before writing, and echo `manualRelease: true` in its
receipt. This also rejects calls from a gateway version without the
single-button contract. Legacy upload includes the recorded `mergeCommit`
and `target`. The program returns one JSON result. Standard output is reserved for the result. Use
the pair of `id` and `action` to correlate provider effects and evidence.

The workflow owns repository checks and authorization, exact-head and base
checks, and provider verification. Before each single-button merge, verify that
merging the exact candidate into the current target cannot trigger release.
Account for the resulting workflows and current provider-side automation.
Use a merge mechanism that keeps this guarantee through the write. Return
`blocked/release-policy` if separation cannot be established. For GitHub,
enforce the expected head at the merge write and read back the actual merge commit. For upload, verify
the source and release artifact, developer app, version and applicable
checks using the project's release tooling. Keep any provider-specific
observations and uncertain effects in that tool's own ledger. Stdout must
echo the request identity and report one of these outcomes:

| Status | Additional fields and meaning |
| --- | --- |
| `blocked` | `reason` is one of `stale-source`, `conflict` (merge only), `release-policy` (single-button merge only), `checks`, `authorization`, `target-unavailable`. Use only when the requested effect is confirmed absent. |
| `merged` | `mergeCommit` is the provider-confirmed full merge SHA. |
| `uploaded` | `version` and `receipt` are the verified developer version and receipt identifier. Echo the exact `mergeCommit` and `target`. |

An error, timeout or unusable result after starting the program leaves the
effect unknown. A gateway restart retains that distinction and never
automatically repeats a started action. After confirming the previous workflow
and its provider operations have settled, the local operator can inspect the
provider and record the result through the authenticated gateway:

```sh
npm run handoff -- visual-reconcile <consumer-state-root> <delivery-id> <absolute-private-inspection>
```

The owner-only JSON file names the original adapter `id` (delivery ID) and the exact `action`, `repository`, `commit`,
`pullRequest` and `base`, plus an `evidence` reference to the inspection.
Upload observations also include the original `mergeCommit` and `target`.
Use `status: "absent"` if the provider confirms no effect, `status: "merged"`
with the verified `mergeCommit`, or `status: "uploaded"` with the verified
`version` and `receipt`. The command retains the prior unknown state and
inspection record, then updates the existing card. A confirmed absence
releases the corresponding guard. Any later write requires a separate click
on an eligible card. An exact repeat of the inspection records one outcome.

Drain queued actions and pending
card updates before replacing the gateway. Preserve its visual review
ledger during backup and rollback.

The gateway reads only the selected checkpoint PNGs with verified digests, the
same clean captured source and runtime across scenes, and a matching origin and
HEAD before and after the read. Passed or failed scenarios with settled capture
can provide evidence. Inconclusive reports stay in UI-eval. The outbox holds temporary private image bytes until upload returns
an `image_key`. It reuses the confirmed keys and message UUID for message
retry. Image upload and delivery run separately from ordinary replies and
native prompts. SQLite overwrites the staged bytes during key replacement.
Exact duplicate plans look up the same receipt before inspecting the worktree,
so retained delivery can be checked after the original files move.
Explicit content denial returns `content-rejected`. At the 55-minute receipt
deadline, an outstanding delivery becomes `delivery-unconfirmed`. That bound
keeps automatic sends inside Feishu's one-hour UUID deduplication window.
Apply the same privacy controls to the transport database and its snapshots
as to the source screenshots. Uploading sends the selected image bytes to
Feishu. The original validation and its scope remain in UI-eval.

For an unconfirmed local command, retry the same execution and plan. A
confirmed queue ID means the receipt was recorded for delivery. Before a
gateway upgrade or downgrade, quiesce the current gateway to stop new visual
receipt admission and drain its outbox with that version. This keeps any
outstanding retry on its original message format and UUID. Keep the current
gateway running if its outbox cannot drain.

Older pinned Web engines can emit an integration source digest without the source object. The runner uses the pinned engine's digest function to match a canonical adapter report and its embedded source to the digests in the integration summary before retaining its commit.

## Upgrade and isolated probe

Drain tasks, controls, prompts and delivery before coordinated gateway/Worker replacement. Do not activate a mixed-version pair for selected tasks. The compatible rollback converter requires terminal selections, inspected guarded unknowns and drained final projections; it archives the additive ledger and original native reports. Retain project report files separately. Never restore an old database over new receipts.

After required checks/build, this explicit probe consumes one real Codex turn:

```sh
node scripts/verify-project-handoff.mjs --native \
  --engine /absolute/path/to/reviewed-ui-eval --revision FULL_REVIEWED_COMMIT \
  --output /absolute/path/to/empty/private-evidence \
  --browser-channel chrome --codex /absolute/path/to/codex
```

It uses the engine's prepared-web fixture and actual CLI, retaining native/checkpoint and JSON/HTML evidence. Transport/scheduling are synthetic; it does not connect Feishu, validate a business feature or authorize publication. Keep candidate source unchanged during capture. Real owner transport and an explicitly authorized business task retain separate gates.
