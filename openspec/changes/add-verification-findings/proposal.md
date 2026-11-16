# Verification findings

## Why

Completed verification and repair records are currently visible only when the owner knows an execution ID. The first discovery source can reuse those retained observations without a scanner, model manager, second backlog or additional execution authority.

## What changes

Add owner-private `/findings` to the P1 gateway. Derive a bounded view of the latest registered verification task per profile from the owner's recent history. Show non-passing records as historical leads, separating execution uncertainty, unavailable evidence and pending work from confirmed recorded verification outcomes. Link each entry to `/verification` and recheck historical applicability where evidence is available.

## Scope

This is manual, read-only discovery from retained records. A new real owner task through existing admission is still required for any execution. No scheduling, model call, task acceptance, automatic issue closure, repair retry, business scanning, release or configuration change is added. Ordinary `/verify` and `/verify-repair` remain unchanged. Live transport acceptance is separate from source and fixture checks.
