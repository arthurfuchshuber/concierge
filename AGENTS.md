# Architecture rules

- Every floating surface must register with `global-overlay-store`; this keeps blur and outside-click order consistent across nested UI.
- Consecutive stays are reconciled from authoritative reservation dates; superseded open stages close without fabricating cleaning data.
- Panel entry resolves the authenticated user's own properties and active memberships independently of active-account RLS; this prevents a circular first-login lockout.- Every access grant, account creation, password change, company link or access removal must email the recipient (template `access-notice`); users are never left unaware of changes to their own access.
- Existing users from other companies are linked to a new company without overwriting their password; multi-company membership is supported.
- The landing guide is a separate copy (`vitrine-casa-charmosa`) owned by a technical demo user, auto-synced from the official `charmosa` guide on view (max every 2 min) with sensitive fields replaced by fictitious ones and no access gates; plan features come from the source owner.
