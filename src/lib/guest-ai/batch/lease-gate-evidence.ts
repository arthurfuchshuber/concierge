/**
 * EVIDÊNCIA do Gate B3.1 — arquivo GERADO pela suíte Postgres real (`__tests__/b31-lease-pg.test.ts`
 * com `GUEST_AI_LEASE_EVIDENCE=write`). Não editar à mão. Os hashes amarram a evidência à migration e
 * ao adaptador exatos que foram testados; `b31-lease-gate.test.ts` falha se divergirem.
 */
export const LEASE_GATE_EVIDENCE = {
  generatedAt: "2026-11-04T03:44:46.361Z",
  postgres: "16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)",
  migrationSha256: "e69c16425c5617d935f2c59d209cf319a86ab62006019cb41a562660250fe673",
  storeSha256: "01db9826d50b334d1953d82528d8c4015bf722d5b07795c4364cee8e1bc17299",
  criteria: {
    "migration_applied": true,
    "rls_and_privileges": true,
    "skip_locked_real_concurrency": true,
    "cas_version": true,
    "stale_owner_rejected": true,
    "expiry_recovery_new_owner": true,
    "expired_owner_cannot_renew": true,
    "retries_capped_at_3": true,
    "batch_strict_closure": true,
    "deferred_no_loss_no_dup": true,
    "different_conversations_parallel": true,
    "model_matches_database": true,
    "store_adapter_against_real_db": true
  } as Record<string, boolean>,
} as const;
