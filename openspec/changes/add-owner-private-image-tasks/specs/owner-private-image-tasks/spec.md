## ADDED Requirements

### Requirement: Same-message screenshot tasks

The P1 gateway SHALL accept supported image attachments accompanying an ordinary written task from the enrolled owner in the registered private chat. The actual event identity and prose SHALL determine admission, task authority and matter routing. Image resources SHALL be bound to the admitted message and read with the existing image count, byte and time limits.

#### Scenario: A screenshot accompanies an explicit new topic

- **WHEN** the owner sends a supported rich post with an explicit new-topic request and screenshots
- **THEN** the gateway admits one request to the new matter and passes the screenshots to Codex as image inputs
- **AND** a repeated delivery does not create another request or change the matter

#### Scenario: An attachment cannot be read

- **WHEN** an admitted request's expected image resources cannot all be read
- **THEN** the gateway reports that the task did not execute and no Codex model turn starts

#### Scenario: Images accompany a reserved control or a running-task supplement

- **WHEN** an owner rich post contains an image with a reserved control or attempts to attach an image to the in-place supplement of a waiting or running request
- **THEN** the post does not apply that control or alter that request

### Requirement: Explicit local file handoff

The gateway SHALL retain the registered owner-private file message identity and acknowledgment intent, and SHALL defer download and task execution until an explicit ordinary reply selects that message. It SHALL bind the downloaded bytes to that reply, preserve a verified original task or answer anchor and limit acquisition and streaming by byte count and elapsed time. The Worker SHALL materialize a private execution-scoped copy for the model's existing filesystem tools. The Worker SHALL send only file metadata and path as input. Terminal projection or inspected recovery SHALL remove the working copy and retire the reference payload without reclassifying an unknown outcome.

#### Scenario: Reply to a file that quotes a completed task

- **WHEN** the owner registers a file by replying to a completed ordinary task, then replies to the file with instructions
- **THEN** one follow-up request resumes the original thread and the Worker exposes the exact file bytes through a task-bound local path
- **AND** an intervening topic switch, redelivery or gateway restart does not substitute another file or thread

#### Scenario: Unsupported local format or failed transfer

- **WHEN** the selected file has an unfamiliar extension
- **THEN** the gateway applies the same receipt, ownership and transfer limits
- **AND** the model may inspect it with the authorized tools available in that turn
- **AND** an unreadable transfer or unverified original anchor never dispatches a model turn with silently missing input
