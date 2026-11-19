## Why

The refund pilot queries SLS evaluation history on a fixed cadence. A dedicated queue can deliver firing notifications while the gateway is idle or offline. The existing observer can still collect evidence and follow up on the incident.

## What changes

- Add optional SLS EventBridge and SMQ ingress for the managed gateway.
- Check the EventBridge envelope and exact account, region, project and rule before recording a firing.
- Persist the notification and its observation intent before acknowledging its queue receipt.
- Keep the existing one-shot observer available for bounded historical investigation.
