# Architecture rules

- Every floating surface must register with `global-overlay-store`; this keeps blur and outside-click order consistent across nested UI.
- Consecutive stays are reconciled from authoritative reservation dates; superseded open stages close without fabricating cleaning data.
- Panel entry resolves the authenticated user's own properties and active memberships independently of active-account RLS; this prevents a circular first-login lockout.- Every access grant, account creation, password change, company link or access removal must email the recipient (template `access-notice`); users are never left unaware of changes to their own access.
- Existing users from other companies are linked to a new company without overwriting their password; multi-company membership is supported.
- The landing guide is the real guide (`/g/<slug>?preview=1&demo=1`) in an iframe, never a copy; demo mode masks secrets server-side (guide data and AI chat) and skips team notifications, so guide changes appear there automatically.
