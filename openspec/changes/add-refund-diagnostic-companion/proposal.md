# Add a bounded refund diagnosis supplement

## Why

SLS can timestamp the two channel rows of one backlog run on opposite sides of the final observation cutoff. A private incident card currently reports an incomplete sample even when a bounded read can find the companion row.

## Scope

The observer may make one short read after that cutoff to find the missing channel for the same batch. It stores a separate diagnostic result and the managed gateway presents it on the same incident milestone card. The original sample and its recovery assessment retain their evidence boundary. This change adds no new authorization, schedule, messaging audience or refund action.
