## Cloud route

Add one EventBridge channel to the scoped SLS action strategy. Match the exact rule and Firing event type in a dedicated route to one SMQ queue. Check the same identity again when the gateway consumes the message. An explicitly registered CLI profile assumes a queue-scoped RAM role for short-lived SMQ credentials. SLS evidence continues to use the existing fixed read-only source.

## Observation

An authenticated notification records that SLS reported a firing. Diagnostic findings and recovery still use bounded SLS reads and the existing observation rules. A durable inbox marker keeps the read due after a restart. Repeated receipts for the same CloudEvent reuse the existing marker. After an idle gap, the first read starts around the current observation period. The retained history watermark advances only after successful reads. An open incident keeps continuous history across its follow-ups.

The single gateway loop waits on the queue between work items. Empty receives alone cause no SLS reads. Shutdown and maintenance prevent later receive cycles and leave a receipt that returns during the pause available for redelivery. A card published during SLS read failure can show the observed firing and pending diagnosis.

## Deployment

Source, content template, queue, RAM roles and launch configuration require coordinated activation. Validate first against an isolated queue and actual deployed event shape. Dedicated queue permissions authorize only receipt and acknowledgment. Neither a queue event nor a notification-card delivery admits a Codex task.
