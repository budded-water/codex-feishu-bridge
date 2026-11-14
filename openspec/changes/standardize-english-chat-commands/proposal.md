# Standardize English chat commands

## Why

The owner requested English slash commands throughout the bridge. The legacy bridge, P1 gateway and native owner currently recognize different Chinese command tokens and advertise them in prompts and guides. Changing only help text would leave real execution and approval paths inconsistent.

## Scope

Use `/steer`, `/approve`, `/reject`, `/answer`, `/notify`, `/recover`, `/queue` and `/withdraw`; retain already-English commands and use `/status details`. Keep ordinary Chinese conversation and notification/control intents. Remove Chinese slash aliases and direct unsupported commands to English help. Add gateway-local `/help` for the P1 commands it actually supports. Preserve ownership, approval/target binding, request text spacing, durable original message identities and unknown-outcome rules.

Synchronize current guides and unarchived specifications. Dated live records remain historical facts, with the syntax change recorded separately. No stored controls/transcripts are rewritten. Upgrade gateway and Worker together only after existing execution/control/prompt/delivery state drains; use compatible artifacts for any post-upgrade pending controls.

## Delivery

This is user steering of the existing queue-control PR. Keep PR #11 open above its existing base. Require the full behavioral/build check, actual pinned scripted Hub/Worker verification, strict specification validation, exact-head CI/preflight and independent complete-diff review. Deploy an immutable reviewed artifact with closed-state backup and managed readiness. Record actual live command round trips separately; the prior queue live-acceptance gap remains open until exercised.
