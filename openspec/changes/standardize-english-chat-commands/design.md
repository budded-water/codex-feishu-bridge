# Design

## Command contract

Canonical slash tokens are ASCII lowercase: `/steer`, `/approve`, `/reject`, `/answer`, `/notify`, `/recover`, `/queue`, `/withdraw`, plus existing `/help`, `/status`, `/stop`, `/clear`, `/new`, `/project` and `/chat`. Detailed status uses `/status details`. Core bridge commands and P1-supported commands remain distinct: the pilot advertises only its supported live controls, recovery and queue operations. Natural Chinese requests are not aliases for approval or recovery.

Update literal dispatch, regex admission, forwarded natural-control construction, native owner/probe allowlists, action previews, help and developer instructions together. Do not normalize or rewrite retained messages; journal and owner receipt identity remains the exact received content. Preserve the one-separator handling for free-form steering and answer bodies.

## Retired syntax and authority

Chinese slash spellings are no longer active commands. Unsupported slash commands produce help rather than model work or decisions. P1 approval requests still require the configured deciding actor/chat; maintenance still requires the enrolled owner/private approval role. Gateway `/help` is a local deduplicated reply, including when maintenance is paused, with no scheduling or inference.

## Upgrade and evidence

Gateway and Worker/native-owner allowlists must run the same command generation. Drain active executions, pending controls/prompts and delivery before the reviewed artifact switch. Preserve state/config snapshots and all post-upgrade receipts. A downgrade with pending English controls cannot dispatch them through an old Chinese-only owner; drain with the compatible artifact first. Examples/configuration fields, native protocol bindings and subscription authentication are unchanged.

Current documentation/specification examples use English. Dated acceptance retains earlier syntax and does not imply the new tokens were live-tested on those dates. The new record distinguishes automated command behavior, managed activation and any actual owner round trip. Queue-withdrawal live acceptance remains separately pending.
