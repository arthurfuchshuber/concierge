# Offline rules

- Situation records (photos/videos/audio/files) are saved to an on-device IndexedDB outbox (`situation-outbox.ts`) and sent by `SituationOutboxRunner` with a client-generated group id and fixed file paths; creation/append are idempotent so retries after slow mobile networks never lose or duplicate records.
- "Finalizar Limpeza" is saved to an on-device IndexedDB queue (`stage-outbox.ts`) and delivered by `StageOutboxRunner` with retries until the server confirms; pending cards are filtered from checkout lists (`semPendentes`) so a weak mobile connection never loses the completion or makes the card reappear.
