-- RECOMENDAÇÕES: EXCLUÍDO NUNCA VOLTA + RAIO DE 30 KM (24/09/2026)
--
-- Regras explícitas do cliente:
--   "o puxador automático precisa se limitar OBRIGATORIAMENTE a um raio de
--    30 km da residência e não mais que isso"
--   "eu quero que EXCLUÍDOS NUNCA voltem"
--
-- 1. `city_references.excluded_at`: excluir um ponto "Pela cidade" deixa a
--    linha oculta (is_hidden) com a data da exclusão, em vez de apagar — a
--    geração reconhece o lugar pelo place_id e nunca o reativa. Só a adição
--    manual traz de volta (limpa as duas marcas).
-- 2. `property_rec_exclusions`: o "Aqui pertinho" é regravado inteiro a cada
--    salvamento, então os lugares excluídos ficam registrados aqui e a geração
--    automática os ignora.
-- 3. Limpeza: pontos de origem AUTOMÁTICA a mais de 30 km do imóvel (do
--    imóvel mais próximo, quando o guia está em grupo) saem — foram gravados
--    pela regra antiga (centro da cidade, 35–50 km). Pontos adicionados à mão
--    ficam, mesmo longe: foram escolha do anfitrião. Backup em
--    `recs_radius_cleanup_20260924`.
--
-- Idempotente.

alter table public.city_references add column if not exists excluded_at timestamptz;

create table if not exists public.property_rec_exclusions (
  property_id uuid not null references public.properties(id) on delete cascade,
  scope text not null default 'nearby',
  place_id text not null,
  excluded_at timestamptz not null default now(),
  primary key (property_id, scope, place_id)
);
alter table public.property_rec_exclusions enable row level security;

create table if not exists public.recs_radius_cleanup_20260924 (
  row_data jsonb not null,
  distance_m double precision,
  removed_at timestamptz not null default now()
);
alter table public.recs_radius_cleanup_20260924 enable row level security;

with ref_dist as (
  select
    c.id,
    (
      select min(
        2 * 6371000 * asin(sqrt(
          power(sin(radians(c.lat - p.lat) / 2), 2)
          + cos(radians(p.lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - p.lng) / 2), 2)
        ))
      )
      from public.properties p
      where p.lat is not null and p.lng is not null
        and (
          p.id = c.property_id
          or p.id in (select m.property_id from public.city_reference_group_members m where m.group_id = c.group_id)
        )
    ) as d
  from public.city_references c
  where c.lat is not null and c.lng is not null
    and coalesce(c.source, 'auto') = 'auto'
    and (c.property_id is not null or c.group_id is not null)
), alvo as (
  select id, d from ref_dist where d > 30000
), bkp as (
  insert into public.recs_radius_cleanup_20260924 (row_data, distance_m)
  select to_jsonb(c), a.d from public.city_references c join alvo a on a.id = c.id
  returning 1
)
delete from public.city_references c using alvo a where c.id = a.id;

-- ROLLBACK da limpeza (manual):
-- insert into public.city_references
--   select (jsonb_populate_record(null::public.city_references, row_data)).*
--   from public.recs_radius_cleanup_20260924;
