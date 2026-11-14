## Why

The owner-private recovery flow works through Feishu, but the last live test still required local process and Hub inspection. The current one-line preview does not explain which facts are verified or missing. Add a bounded diagnostic report to the existing recovery view without expanding recovery authority.

## What Changes

- Capture private, request-bound owner/native process identities and bounded observed descendant relationships while an assigned native child runs.
- Expand `/恢复` with task-scoped native connection, sealed-journal, registered-process, queue and source-scoped Hub observations.
- Label each observation as verified, running or unverified, include snapshot time/coverage, and retain explicit human effects inspection.
- Make report collection read-only for admission, native journals and Hub. Preserve normal receipt/outbox delivery and existing confirmation revalidation.
- Archive the optional process metadata with closed native evidence during migration/rollback.

## Scope

No process termination, queue changes, guard release, task replay, model inference, automatic side-effect judgment, new credentials or Hub management capability is added. Process sampling is bounded and observational; detached or unobserved descendants are outside its completeness claim. Missing/legacy metadata remains unverified. Existing recovery confirmation retains its own authorization and evidence checks.

## Delivery

Use a separate dependent PR above the completed P2 recovery branch. Keep the prior PRs open pending owner merge authorization. Candidate checks, complete-source independent review and actual deployment acceptance remain separate evidence.
