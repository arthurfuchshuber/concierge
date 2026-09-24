-- LIMPEZA DAS RECOMENDAÇÕES SEM USO (pedido explícito, 24/09/2026 — já
-- aplicado direto no banco).
--
-- Depois do isolamento por conta (cada guia só enxerga as próprias
-- recomendações) e do desligamento da rotina semanal, sobraram:
--   1. linhas de `city_references` SEM imóvel e SEM grupo ("da cidade"): a
--      rotina antiga gerava, nenhum guia mostrava. Saem (backup completo em
--      `recs_orphan_cleanup_20260924`).
--   2. `city_reference_jobs`: só a página "Na Cidade" (desativada) lia.
--   3. o nó de permissão "Cidades" (`admin.cidades`) da página desativada —
--      sem nenhuma concessão a membros. Sai junto com as atribuições dele.
--
-- Idempotente.

create table if not exists public.recs_orphan_cleanup_20260924 (
  row_data jsonb not null,
  removed_at timestamptz not null default now()
);
alter table public.recs_orphan_cleanup_20260924 enable row level security;

with alvo as (
  select id from public.city_references where property_id is null and group_id is null
), bkp as (
  insert into public.recs_orphan_cleanup_20260924 (row_data)
  select to_jsonb(c) from public.city_references c where c.id in (select id from alvo)
  returning 1
)
delete from public.city_references c where c.id in (select id from alvo);

delete from public.city_reference_jobs;

delete from public.permission_nodes where slug = 'admin.cidades';

-- ROLLBACK das linhas (manual):
-- insert into public.city_references
--   select (jsonb_populate_record(null::public.city_references, row_data)).*
--   from public.recs_orphan_cleanup_20260924;
