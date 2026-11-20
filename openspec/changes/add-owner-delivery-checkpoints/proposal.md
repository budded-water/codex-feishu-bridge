# Add owner delivery checkpoints

## Why

An owner-private task can finish while its deliverable awaits review. The original
conversation can continue after restart. A separate checkpoint is needed to
identify exactly which candidate the owner is reviewing and to associate the
next requested work with that candidate.

## Scope

- Store one immutable, owner-registered evidence reference for a completed
  ordinary task in the shared admission database.
- Let the owner inspect the checkpoint and confirm that exact reference while
  stating the next task. Reuse ordinary same-thread continuation.
- Exercise a mobile candidate and a Web preview through the same command family.
  Release, deployment and project verification tools keep their own authority.
