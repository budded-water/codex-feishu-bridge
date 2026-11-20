## Ownership

The local operator picks a task, candidate and report/checkpoint references in
an owner-only plan. The gateway validates the completed private task, source,
report hashes and matched PNG metadata. The outbox stages the verified bytes
and holds the Feishu keys after upload. The task keeps its previous results.
The confirmed receipt becomes a normal reply anchor for that task.

The receipt preserves the selected report outcomes, candidate and environment.
Upload or delivery failure uses transport retry, independent of Codex and
the verification runner. A repeated plan reuses its delivery identifier.
