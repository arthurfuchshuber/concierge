/**
 * EVIDÊNCIA do Gate B3.1 — arquivo GERADO pela suíte Postgres real (`__tests__/b31-lease-pg.test.ts`
 * com `GUEST_AI_LEASE_EVIDENCE=write`). Não editar à mão. Os hashes amarram a evidência à migration e
 * ao adaptador exatos que foram testados; `b31-lease-gate.test.ts` falha se divergirem.
 */
export const LEASE_GATE_EVIDENCE = {
  generatedAt: "2026-11-04T04:54:36.427Z",
  postgres: "16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)",
  migrationSha256: "4501bf5ecde0907cacd66b190299837888c9da96021b8fc349cfae10b6144de3",
  storeSha256: "f52b1a5b22b5c8c1de8e75ecfbc38244ec24749ca3fd0afb0130485158491298",
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
