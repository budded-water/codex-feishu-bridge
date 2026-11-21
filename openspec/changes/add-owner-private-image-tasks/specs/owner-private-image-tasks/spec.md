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
