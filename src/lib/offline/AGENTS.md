# Offline rules

- Situation records (photos/videos/audio/files) are saved to an on-device IndexedDB outbox (`situation-outbox.ts`) and sent by `SituationOutboxRunner` with a client-generated group id and fixed file paths; creation/append are idempotent so retries after slow mobile networks never lose or duplicate records.
