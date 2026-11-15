# Design

## First vertical slice

One explicitly selected task, one trusted project profile, one pinned deterministic verification invocation and one durable evidence association. Start with an isolated fixture, then a real authorized project task. Preserve existing native conversation, admission and delivery contracts. Do not add another model manager or force the model's internal problem-solving into a fixed workflow.

## Technical choices

Use UI-eval's existing `integrate <suite> --project-root <root> --format json` CLI through a trusted project adapter. The adapter supplies fixed argv and the reviewed engine checkout/runtime; chat text and report content cannot supply executables or modules. No UI-eval source is copied into this repository and no moving `main` revision is executed. Resolve the current engine's actual output schema and compatibility before implementation.

Keep preparation, checks, scenarios, cleanup, evidence verification and required visual review in the engine/project contract. The bridge receives a bounded validated result from that invocation; a schema assertion alone is not evidence attestation. Preserve candidate source identity, suite/plan/engine identity, task/native execution reference, actual exit or signal, cleanup disposition and both canonical JSON/human HTML references. Project/source attribution must be established by the trusted invocation, not taken from model prose or a user-supplied report path.

Use the existing private state/evidence ownership and transport projection patterns. Persist a verification intent before launch and its observed terminal result separately from the native task outcome. A crash or unknown command/cleanup outcome retains an inconclusive handoff and never authorizes a rerun. Final-answer delivery retries cannot relaunch verification. The concrete record/schema and additive migration are implementation tasks; this proposal does not claim an installed API or configuration field.

## Result semantics

Preserve engine `pass`, candidate failure, `needs-review`, infrastructure/inconclusive and interrupted states. Validate the actual CLI envelope, matching output files and required projections; absence, contradiction, stale source or partial cleanup is not pass. Maintain separate code/UI/release conclusions when provided by the engine's declared verification plan. A plan-free smoke is only that smoke. Independent code review and release authorization cannot be manufactured from a UI result.

The first slice records evidence observed at invocation completion. It does not introduce a generic historical-report importer or reusable acceptance cache. Later display distinguishes the recorded observation from current applicability; source/profile changes make it stale. Release Kit continues to require its own trusted project's evidence revalidation before delivery. If that revalidation cannot prove freshness, publication remains blocked.

## Human and automation boundaries

Feishu remains the human entry for decisions. A required visual review remains pending until its owning workflow accepts evidence-bound human review; this harness cannot convert an automated screenshot capture into that review. A product failure may be returned to the associated native task only through an explicitly bounded follow-up policy implemented in a later slice. Infrastructure failure is not permission to repair source or spin another loop.

Release Kit is used only for a task with an authorized publication goal and trusted adapter. Its journal is canonical; do not create a second release ledger or infer approval from a completed verification. Discovery remains P4 and cannot silently turn observations into execution grants.

## Acceptance

Use real boundaries: an actual child CLI process for output/signal/cleanup and lost-ack tests; SQLite persistence for task association/restart/delivery; matching pinned-engine fixtures for result interpretation; and one actual authorized project invocation for live evidence. Synthetic tests are labeled as such. Do not change candidate source during UI capture. Preserve both JSON and HTML and the engine's own scope limitations.

## First implementation contract

The enrolled private owner/approver explicitly submits `/verify <profile> <task>`. This admits one normal native task and an immutable verification selection in the same SQLite transaction. The original message remains the trigger; only the task body is supplied as native input with the trusted project target. Profiles are optional private handoff configuration, loaded by both gateway and Worker. A profile fixes project root/ID, suite ID, exact engine revision, built CLI/library hashes, reviewed policy-file hashes and deadline. Chat cannot supply paths, commands or module names. Ordinary tasks do not select verification.

The existing execution-ID native owner runs verification after a completed Codex turn, before sealing its checkpoint and releasing the existing project guard. The actual Worker assignment therefore remains occupied throughout capture. An incomplete native turn skips verification. Planned/running/observed/skipped/unknown verification facts are separate from the native outcome. An owner stop during verification aborts the CLI with its supported signal cleanup; it does not start another model turn. A missing/invalid handoff or unsettled cleanup retains an unknown execution guard; the native completion remains in the sealed report. Initial verification uncertainty requires inspected local maintenance, rather than silently widening the existing Feishu native-recovery contract.

The verifier checks the current trusted profile against the admitted digest, verifies clean pinned engine source, built bytes and registered project-policy bytes, snapshots existing integration directories, and launches fixed argv without a shell. It bounds output, validates the returned envelope with the pinned engine's exported validator, requires a fresh generated execution directory, matching canonical JSON and present bounded HTML, records both hashes, and rechecks engine identity and registered policy bytes. CLI/library hashes attest the selected built files, not installed dependency contents. The trusted CLI owns report generation and evidence reconciliation; this is not an importer for arbitrary reports or a sandbox against other processes of the same host account.

Terminal delivery atomically projects a separate bounded verification handoff with the retained native checkpoint. It preserves native chunk sizes, never alters the sealed journal and never retries execution. `/verification <execution-id>` reads the owned observation. Results are historical observations, not reusable acceptance. Profile drift, changed Git HEAD or modified report bytes are stale; dirty source has unverified applicability. Even unchanged source does not attest current environment or release eligibility. Reports remain private local references in this first slice, without automatic upload or publication. Downgrade requires all verification selections terminal and final projections drained, and archives the additive ledger with the original native reports.
