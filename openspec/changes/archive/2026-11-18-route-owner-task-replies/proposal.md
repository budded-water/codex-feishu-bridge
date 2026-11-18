## Why

A private Feishu user can split one request across several messages. Today a plain reply to an owned task normally starts another task. The reply target already provides the identity needed to attach the message to the right task.

## What changes

- Use a verified reply to the owner's ordinary task as a supplement before or during its execution.
- Admit a linked follow-up in the same verified Codex conversation after confirmed settlement.
- Persist the decision and project a Feishu receipt when text is merged, queued as a follow-up or rejected. Reuse the existing native receipt for accepted live steering.
- Keep the existing AutoLoop assignment identity, native authorization and explicit command paths.

## Scope

The change applies to ordinary messages in the registered owner-private P1 chat. Group routing, approval commands and specialized verification, repair and retry tasks keep their existing paths. Live activation and genuine Feishu acceptance require a separate operational gate.
