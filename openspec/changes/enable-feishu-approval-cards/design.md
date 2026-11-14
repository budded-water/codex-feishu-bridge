# Design

## Presentation

Use app-bound Card JSON 2.0 with purpose, full redacted action, compact human context/deadline and two buttons. A neutral workspace is labeled as such instead of exposing the internal pilot alias. Remove duplicate truncated task text and self mentions. Keep a compact manual /approve or /reject alternative. Known local size limits and non-same-private-chat scopes use the same clear Markdown layout with the complete action; no HTTP-error type fallback is allowed after an uncertain send.

## Identity and authority

A private persisted presentation has an opaque UUID selector, original prompt, task, tenant/chat, expiry and exact native target. It is not authorization by itself. Callback input comes only from the authenticated SDK dispatcher, with app/tenant/operator and card context checked; value supplies only selector and approve/reject choice. Confirm the actual delivered message ID before accepting a click. Unknown delivery is rejected rather than inferred from a callback. Server-generated control text carries a distinct durable event identity, never arbitrary callback text.

Core decisions revalidate the live native prompt. The pilot atomically admits the callback control with its original target and execution; no later lookup may retarget it. Native owner policy remains authoritative for actor/chat, expiry and generation. Duplicate callbacks and competing decisions must not produce another native reply; uncertain dispatch is lookup-only.

## Projection and updates

Native outbox/journals retain typed redacted presentation data. Pilot projection validates it against the bound native outcome and retains its selector while namespacing local prompt identity. Actual message IDs and UI-update delivery live in the transport state. Sealed journals are never mutated. Legacy journals without new optional columns remain readable.

The existing durable outbox also carries updates to acknowledged card message IDs. UI-update retries never repeat native work or create replacement cards. Confirmed native decision submission, expiry and invalidation remove active controls; labels describe decision submission rather than completed business effects. Explicit deleted-message outcomes retire the update. Initial uncertain delivery cannot be assumed acknowledged; such clicks remain unconfirmed even if a stale card is visible.

## Operations

Add only card.action.trigger to the existing application callback subscription and receive it through the existing connection. Return a bounded toast after local durable acceptance within the platform deadline; no model/native/network await in the callback. Drain active work, controls, prompt/card delivery and updates before coordinated gateway/Worker upgrade. Compatible converters archive new card tables/optional journal data and preserve callback command identities and sent-message facts; never restore old snapshots over newer decisions.
