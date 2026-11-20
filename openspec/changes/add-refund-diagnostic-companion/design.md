# Design

The final observation owns an exclusive cutoff. If exactly one fresh, consistent backlog row with a run fingerprint is present, read from the cutoff through at most 15 seconds and no later than the observation time. Reuse the registered SLS runtime query and accept only a consistent missing-channel row with the original run fingerprint and a timestamp in that interval. An incomplete or invalid read and a complete read without a match have separate outcomes. Maintenance prevents a new supplemental read.

Store the outcome as an optional field in the same private observation JSON transaction. Assessment uses the original backlog and recovery evidence fields. A persisted diagnostic result does not schedule another read or alter a previous observation. The owner-private card displays the result as a separate section and keeps the existing incident identity and reply route.
