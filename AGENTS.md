# Architecture rules

- Every floating surface must register with `global-overlay-store`; this keeps blur and outside-click order consistent across nested UI.
- Consecutive stays are reconciled from authoritative reservation dates; superseded open stages close without fabricating cleaning data.
- Panel entry resolves the authenticated user's own properties and active memberships independently of active-account RLS; this prevents a circular first-login lockout.- Every access grant, account creation, password change, company link or access removal must email the recipient (template `access-notice`); users are never left unaware of changes to their own access.
- Existing users from other companies are linked to a new company without overwriting their password; multi-company membership is supported.
- The landing guide is a separate copy (`vitrine-casa-charmosa`) owned by a technical demo user, auto-synced from the official `charmosa` guide on view (max every 2 min) with sensitive fields replaced by fictitious ones and no access gates; plan features come from the source owner.

- Channex ARI output always flows calendar diff → `channex_ari_outbox` → one batched call per kind → DB-counted 20/min limiter with retry (`src/lib/channex-ari.server.ts`); never call ARI endpoints directly or on a timer, so certification rules (delta-only, rate limits) hold.
- Channex bookings are read only via `booking_revisions` and each processed revision is ACKed idempotently (`channex_booking_acks`).
- Channex ARI outbox retries run from a 1-minute cron (`/api/public/cron/channex-ari-retry`) that only flushes due pending rows; never full-sync from a timer.

- Airbnb listing data is ingested read-only from Channex into `property_listing_raw_data` (raw + normalized facts) and indexed as AI source `airbnb_listing` (top tier); only listings in `PILOT_LISTINGS` (`src/lib/channex-listing.server.ts`) are synced, so unvalidated properties stay untouched.
