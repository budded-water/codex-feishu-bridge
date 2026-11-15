# Project verification handoff

## Why

The remote execution baseline can correlate a task, native turn and delivered answer. A completed native turn does not establish that a changed feature passed its project checks, UI acceptance, required review or release conditions. The next bounded slice should make those distinctions visible while preserving native Codex exploration and tool use.

## Scope

Add an opt-in task-bound handoff to a trusted project verification adapter. Start with the existing pinned UI-eval `integrate` CLI and its canonical JSON/HTML results. The project owns its suite, verification plan, fixtures and commands; UI-eval owns execution/evidence validation and reconciliation; this harness owns invocation/task identity and a truthful status projection. Do not duplicate UI-eval's policies or repair loop.

Native execution, verification, human review, answer delivery and release remain separate facts. No required evidence means unverified, rather than acceptance inferred from prose or exit zero. General discussion and tasks without a declared verification contract retain their existing execution behavior. Selecting a verification profile for one task does not bind the whole workspace to one product.

This is a proposed P3 slice, not implemented runtime behavior. P2 owner-private card and exact-ID queue acceptance are recorded separately in the dated live evidence; those results do not establish this P3 runtime or broader P2 interaction coverage. Automatic discovery/repair scheduling, arbitrary command execution from Feishu, publication and changes to the scheduler/model runtime are outside this change.

## Owners and references

- [System direction](../../../docs/agent-system-plan.md): P3 scope and autonomy.
- [UI-eval integration runner](https://github.com/budded-water/ui-eval/blob/main/docs/integration-runner.md): canonical execution, output and interruption contracts; inspect the selected reviewed source pin before implementation.
- [UI-eval verification plans](https://github.com/budded-water/ui-eval/blob/main/docs/verification-plans.md): declared requirements, environments, evidence levels and separate conclusions.
- [Release Kit](https://github.com/budded-water/release-kit): separately authorized publication, retained journal identity and project-owned evidence revalidation. It is not a requirement for ordinary coding tasks.

Public visibility of those repositories does not make them licensed open-source packages or authorize registry publication. Use the owner's authorized clean source checkout; no automatic dependency installation or upstream upgrade is introduced.
