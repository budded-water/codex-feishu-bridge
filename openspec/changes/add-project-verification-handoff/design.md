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
