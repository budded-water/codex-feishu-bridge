## Why

P0 demonstrated an isolated native executor behind the pinned Autoloop plugin boundary. Production still has a Bridge-owned queue and Feishu listener. Connecting these components without a handoff contract could merge distinct user requests, share another user's native session, replay uncertain effects or run two consumers for one bot.

The next milestone is one operator chat and one registered pilot project on one host. Ordinary task text in that chat targets the configured pilot project, so it needs no model classifier or mandatory alias prefix. Requests naming unregistered/out-of-pilot projects require clarification or rejection before scheduling. Broad existing multi-project/team behavior remains in the legacy entry point until explicitly migrated; restricting an existing bot's scope requires an approved cutover plan.

## What Changes

- Define one immutable request/execution identity, with verified Feishu ownership and durable source-event submission.
- Keep one request per scheduling lane, serialize the pilot project's native work, and resolve native continuation from the owner-scoped bridge mapping rather than Autoloop's default session inheritance.
- Specify durable live controls, pending native responses and answer delivery without introducing a second business scheduler.
- Retain a project admission barrier after uncertain execution, across new events, retries, business answers and process restarts.
- Define a drain-first, single-consumer cutover, checked state export/import and post-acceptance rollback rules.
- Verify the selected routing configuration against the actual pinned Hub before implementing runtime handoff. No kernel fork is proposed.

## Non-Goals

No current production switch, Feishu test message, global installation or service change. No queue transfer during active work, multi-host failover, automatic project classifier migration, worktree manager, UI-eval loop, release adapter or proactive issue discovery. These later integrations must preserve this contract without claiming they are implemented here.

## Capabilities

- remote-task-handoff: proposed scheduling, identity, control, uncertainty and cutover requirements for the P1 pilot.

## Impact and Acceptance

The eventual runtime change affects ingress persistence, scheduler publication, assignment resolution, native lifecycle/control, transport projections and service startup. Keep the legacy and new entry points mutually exclusive at activation; do not silently redirect existing production traffic while implementing.

The routing feasibility check is model-free and transport-free: actual pinned Hub HTTP with synthetic events and a simulated worker client. Full acceptance additionally requires executable gateway/runner tests, migration rehearsal, pending P0 native interactions/recovery and authorized owner-chat round trips. See [tasks](tasks.md).
