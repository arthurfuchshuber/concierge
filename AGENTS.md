# Architecture rules

- Every floating surface must register with `global-overlay-store`; this keeps blur and outside-click order consistent across nested UI.
- Consecutive stays are reconciled from authoritative reservation dates; superseded open stages close without fabricating cleaning data.
- Panel entry resolves the authenticated user's own properties and active memberships independently of active-account RLS; this prevents a circular first-login lockout.- Every access grant, account creation, password change, company link or access removal must email the recipient (template `access-notice`); users are never left unaware of changes to their own access.
- Existing users from other companies are linked to a new company without overwriting their password; multi-company membership is supported.
- The landing guide is a separate copy (`vitrine-casa-charmosa`) owned by a technical demo user, auto-synced from the official `charmosa` guide on view (max every 2 min) with sensitive fields replaced by fictitious ones and no access gates; plan features come from the source owner.

- Channex ARI output always flows calendar diff → `channex_ari_outbox` → one batched call per kind → DB-counted 20/min limiter with retry (`src/lib/channex-ari.server.ts`); never call ARI endpoints directly or on a timer, so certification rules (delta-only, rate limits) hold.
- Channex bookings are read only via `booking_revisions` and each processed revision is ACKed idempotently (`channex_booking_acks`).
- Channex ARI outbox retries run from a 1-minute cron (`/api/public/cron/channex-ari-retry`) that only flushes due pending rows; never full-sync from a timer.
- Airbnb chat messages arrive as Channex `message` webhooks via the same queue and are handled in `src/lib/channex-messages.server.ts`; the AI replies only when the listing is resolved with certainty and its per-property `airbnb_ai_enabled` switch is on, so no guest gets answers from the wrong property or without host consent.

- Airbnb listing data is ingested read-only from Channex into `property_listing_raw_data` (raw + normalized facts) and indexed as AI source `airbnb_listing` (top tier); only listings in `PILOT_LISTINGS` (`src/lib/channex-listing.server.ts`) are synced, so unvalidated properties stay untouched.
- Airbnb listings are never rate-plan mapped in Channex (ConciergeIA is not a PMS); mapping makes Airbnb hand pricing/calendar to Channex and blocks the calendar. Listing content not exposed by Channex (description, amenities) is read from the public Airbnb page in `fetchPublicListing` (`src/lib/channex-listing.server.ts`).
- Cross-channel guest identity resolves only against official reservations via the `identify_guest` AI tool (code, phone tail, or exact full name incl. co-guests); ambiguous matches require one contextual validation question before sensitive data.
- Sensitive property data (exact address/number, location links, codes, Wi-Fi, internal contacts) is released by the AI only when the channel validates a confirmed active reservation (`reservationVerified` in `runHospitalityAgent`); otherwise credentials are locked, so pre-booking or unverified chats never leak them on any channel.
- Any platform delivery failure/block (Airbnb, WhatsApp) goes through `reportDeliveryFailure` (`src/lib/delivery-failure.server.ts`): forced handoff, `ai_alerts` row and push to property team plus SaaS admins, so blocked replies are never silent.
- Channex availability = listing window (`max_days_notice`) + confirmed reservations + manual blocks created in ConciergeIA; Airbnb iCal "Not available" rows are never used, since they mirror the Channex-controlled calendar and would lock it in a loop.
- A host message arriving from Airbnb via Channex pauses the AI on that thread (`pausePatch`), and every AI reply re-checks the switch and pause right before sending, so the AI never talks over a human.
- Every Channex API response and webhook is stored unfiltered in `channex_raw_records` (upsert by entity_type+channex_id) via `saveRawRecords` (`src/lib/channex-raw.server.ts`); structured columns are derived, so no Channex field is ever lost.

- Server-function bearer tokens come from `attachFreshSupabaseAuth` (`src/lib/fresh-auth-middleware.ts`), which refreshes the session shortly before expiry with a single shared refresh; the generated attacher is intentionally replaced so hourly token rollover never fails calls.
- Permission checks treat a failed lookup as "still loading" and keep the last known decision, never as denial, so transient network/session errors never lock screens into read-only.
