-- MÓDULO FISCAL — carga retroativa única do onboarding.
-- 100% aditiva e idempotente; sem DROP. `initial_sync_at` marca (de forma atômica, via UPDATE ... WHERE initial_sync_at IS NULL)
-- que a carga inicial do tenant já foi tomada: ela corre no máximo uma vez, nunca periodicamente.
begin;

alter table public.fiscal_provider_connections add column if not exists initial_sync_at timestamptz;

commit;
