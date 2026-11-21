## ADDED Requirements

### Requirement: A first request can start a fresh matter

The enrolled private owner SHALL be able to start a separate matter and send
its first ordinary request in one message. Routing SHALL preserve the
original message identity and bound each successful request to the same
canonical project admission and execution rules.

#### Scenario: Explicit fresh topic in one message

- **WHEN** the enrolled owner sends a recognized new-topic phrase with a nonempty ordinary request
- **THEN** the gateway SHALL admit the remaining text into a new conversation and select that matter
- **AND** an older quoted conversation or registered PR binding SHALL retain its identity and SHALL NOT supply its history to the new conversation

#### Scenario: A direct request names an unbound PR

- **WHEN** an unquoted direct read or review request names a single exact GitHub PR without another verified destination
- **THEN** the gateway SHALL admit it to its existing bound matter or start and bind one fresh matter
- **AND** a duplicated Feishu message SHALL NOT create another conversation, request or receipt

#### Scenario: The owner chooses a new topic for a held message

- **WHEN** the confirmed choice card for a held message offers a new topic and the enrolled owner chooses it
- **THEN** the gateway SHALL admit the saved message once, without requiring it to be sent again
- **AND** a duplicate click or restart SHALL retain its first destination

#### Scenario: An unquoted question concerns the preceding message

- **WHEN** an unquoted question uses a recognized Chinese prior-message opening such as `上一条的` or `上一轮里`, a matter is selected, and the message has no additive-subject wording, explicit destination or other complete matter title
- **THEN** shared words in matter titles SHALL NOT take precedence over the selected matter and ordinary admission history
- **AND** if the last eligible task and the selected matter differ, the gateway SHALL present both choices before admission

#### Scenario: Routing receipt explains the result

- **WHEN** a new matter is admitted or a known matter is continued
- **THEN** the existing receipt SHALL identify the actual destination and distinguish a new conversation from a continuation where that fact is established
- **AND** a withheld or blocked request SHALL NOT claim to have started execution
