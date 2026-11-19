## Why

The managed merchant refund backlog alert can describe an aged backlog or a missing channel identity. A recurring alert needs a durable incident and bounded evidence checks before any diagnosis is sent or action is authorized.

## What changes

- Replay one configured SLS evaluation stream. Keep a durable, idempotent cursor and one active incident per source binding.
- Assess fresh, complete, sanitized backlog and recovery observations. Persist two follow-up deadlines and an explicit handoff outcome.
- Prepare a read-only, one-shot observer using the existing Alibaba Cloud CLI. Keep the observer outside the deployed gateway until the source, identity and evidence contract are accepted.

## Scope

This first slice covers detection, deterministic diagnosis and bounded observation. A future change must define machine-source admission and its Codex/Feishu incident binding. Refund submission, SAE Job invocation, financial state changes and product deployment require their respective authorization.
