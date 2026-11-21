## Why

Feishu sends a message that contains both a written request and a pasted screenshot as a rich post. The P1 gateway currently treats that post as unsupported before it can route the written request, including explicit new-topic requests.

## What changes

- Accept ordinary owner-private Feishu posts carrying prose and same-message image resources. Keep routing and task ownership tied to the original event and its written request.
- Reuse bounded Feishu resource downloads and native image input. Stop before starting a model turn if any expected image is unavailable.
- Support new ordinary tasks and follow-up turns on settled ordinary tasks. Retain text-only waiting/running supplements and the existing query and approval entry points.
- Add a format-independent file path for ordinary Feishu file messages. Bind a file only when the enrolled owner replies to that file with instructions, then use its verified original task anchor when available. The gateway owns transport and size limits. The native turn gets a read-only local attachment to inspect as needed.
