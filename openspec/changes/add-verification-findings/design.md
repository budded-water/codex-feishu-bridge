# Design

Admission SQLite remains the authority for tasks and observations. Query at most the latest 100 verification-bearing requests for the current canonical resource and authenticated owner/chat. Select the latest admitted request per profile before inspecting outcome: a newer pass, queued or interrupted task must not resurrect an older failure as the current lead. Display at most 10 non-pass profiles, newest first. State these bounds and that selection does not establish resolution of older problems.

Reuse the execution UUID as the reference and `/verification` as the detail route. There is no new candidate table, mutable issue status, source publication or accepted backlog. A record whose latest observation is pass is omitted from the leads, without asserting that a defect is fixed or its source is currently accepted.

Only the existing enrolled private owner with the approval role may request the view. Validate syntax and unsupported/length limits before scheduling work. Transport State atomically retains message receipt and the resulting durable answer after the asynchronous read; a crash before that transaction may safely recompute this read-only query. Duplicate deliveries produce at most one queued answer. Command events never reach native execution or ordinary admission. Serialize view work using the gateway's existing view chain and await it during closure.

Distinguish active/queued, unknown/protected, absent observation and sealed recorded observation. Validate the closed native evidence with the existing read-only evidence reader before presenting a recorded outcome. Missing or changed evidence stays unverified. Use existing applicability checks for profile/policy/report/source drift. Failures are verification leads, not automatically classified product bugs: infrastructure and human review remain possible causes. Do not interpolate report contents into task commands.

Only transport receipt/outbox writes are permitted. Never call native apply/recover/control/start, modify observation/native journals, release guards, publish source events or invoke UI-eval. A future discovery scheduler or candidate acceptance policy requires a separate change.
