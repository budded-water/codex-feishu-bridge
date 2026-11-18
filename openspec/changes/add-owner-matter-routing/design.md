## Decisions

- Treat a named matter as an owner-scoped durable conversation. Existing owner and project conversations remain the default. Per-request source IDs, worker permits and resource guards retain their existing identity.
- Resolve exact original task replies first. For ordinary inputs, use a confirmed matter-card reply or explicit matter title/registered pull request ahead of selection. Conflicting targets require a choice. Without an explicit target or selection, offer the available matters and the default conversation. A selection is scoped to the enrolled owner and canonical workspace.
- Persist a held message before sending its choice card. Validate the confirmed Feishu message, actor, target and original input on selection. Commit its request and consumption together. Replayed callbacks cannot admit it twice or reset a newer selection.
- Preserve existing default thread, task references and associated retries during additive schema setup. Closed rollback archives matter-specific histories and restores the legacy default selection from the default conversation only.
