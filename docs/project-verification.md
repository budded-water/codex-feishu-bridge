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

Invoke `npm run handoff -- visual-receipt <consumer-state-root> <execution-id> <absolute-private-plan>` against the running pilot. The state root identifies the managed consumer. The command returns the delivery ID and registration status. The Feishu app needs image upload and existing message permissions. A confirmed reply becomes another quotation anchor for the same task. A recalled or deleted original message produces terminal `target-unavailable`, visible when the same plan is submitted again.

The gateway reads only the selected checkpoint PNGs with verified digests, the
same clean captured source and runtime across scenes, and a matching origin and
HEAD before and after the read. Passed or failed scenarios with settled capture
can provide evidence. Inconclusive reports stay in UI-eval. The outbox holds temporary private image bytes until upload returns
an `image_key`. It reuses the confirmed keys and message UUID for message
retry. Supplemental receipts in retry backoff let ordinary replies go
through. Duplicate requests for the same task/report set reuse the receipt.
Apply the same privacy controls to the transport database and its snapshots
as to the source screenshots. Uploading sends the selected image bytes to
Feishu. The original validation and its scope remain in UI-eval.

For an unconfirmed local command, retry the same execution and plan. A
confirmed queue ID means the receipt was recorded for delivery. Before a
code-only downgrade, quiesce the current gateway to stop new visual receipt
admission and drain its outbox with that version. Older gateways cannot
transport pending images. Keep the current gateway running if its outbox
cannot drain.

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
