# Architecture rules

- Every floating surface must register with `global-overlay-store`; this keeps blur and outside-click order consistent across nested UI.
- Consecutive stays are reconciled from authoritative reservation dates; superseded open stages close without fabricating cleaning data.
- Panel entry resolves the authenticated user's own properties and active memberships independently of active-account RLS; this prevents a circular first-login lockout.