-- REPARO DAS CATEGORIAS DE RECOMENDAÇÕES (auditoria, 24/09/2026)
--
-- O que aconteceu: o lápis "Renomear categoria" do editor do guia alterava a
-- TAXONOMIA GLOBAL (poi_categories), a mesma para todos os clientes. Num guia
-- de Foz do Iguaçu, a categoria-base "Compras" (slug `compras`, a da tag
-- `shopping`) foi renomeada para "No Paraguai" — e toda geração de
-- recomendações passou a gravar shoppings de QUALQUER cidade como "No
-- Paraguai" (Ourinhos, por exemplo). Pelo mesmo caminho nasceram duas
-- categorias globais sem nenhuma tag: "Compras" (duplicada) e "Na Argentina".
--
-- O código corrigido (mesmo ZIP) deixa renomear/criar/excluir categoria só
-- NESTE guia e separa sozinho os pontos do outro lado da fronteira pelo país
-- do endereço. Este arquivo conserta o que já estava gravado:
--   1. devolve o nome "Compras" à categoria-base e apaga as duas órfãs;
--   2. reclassifica os pontos marcados "No Paraguai"/"Na Argentina" pelo PAÍS
--      DO ENDEREÇO: endereço no Paraguai → "No Paraguai"; na Argentina → "Na
--      Argentina"; no Brasil → a categoria padrão do tipo ("Compras",
--      "Restaurantes"…). Sem país no endereço: fora de Foz vira a categoria
--      do tipo; em Foz fica como está. Os pontos que de fato ficam no
--      Paraguai e na Argentina (guias de Foz) continuam separados;
--   3. remove pontos "Aqui pertinho" repetidos no mesmo guia (mesmo lugar do
--      Google duas vezes — trocar o link do Maps somava a lista de novo).
--
-- Idempotente: rodar de novo não muda nada. Antes de alterar, cada linha tem
-- a categoria antiga guardada em `recs_category_repair_20260924` (rollback
-- no fim do arquivo).

create table if not exists public.recs_category_repair_20260924 (
  tbl text not null,
  row_id uuid not null,
  old_category text,
  new_category text,
  repaired_at timestamptz not null default now()
);
alter table public.recs_category_repair_20260924 enable row level security;

-- 1) Taxonomia global
update public.poi_categories set label = 'Compras' where slug = 'compras' and label <> 'Compras';

delete from public.poi_categories c
where c.slug in ('compras-na-cidade-2wgj', 'compras-na-argentina-ixgw')
  and not c.is_protected
  and not exists (select 1 from public.poi_tags t where t.category_id = c.id);

-- 2) "Pela cidade" (city_references) — pelo país do endereço
with alvo as (
  select
    r.id,
    r.category as old_cat,
    case
      when x.ultimo in ('paraguai', 'paraguay') then 'No Paraguai'
      when x.ultimo = 'argentina' then 'Na Argentina'
      -- Endereço no Brasil ("…, Brasil" ou terminando em CEP) → categoria do tipo.
      when x.ultimo in ('brasil', 'brazil') or x.ultimo ~ '^[0-9]{5}-?[0-9]{3}$' then x.padrao
      -- Sem país no endereço: fora de Foz do Iguaçu não existe "No Paraguai"
      -- que faça sentido → categoria do tipo. Em Foz, fica como está (pode
      -- ser curadoria manual do anfitrião, sem endereço gravado).
      when r.city_label not ilike 'foz do igua%' then x.padrao
      else r.category
    end as new_cat
  from public.city_references r
  cross join lateral (
    select
      lower(btrim(regexp_replace(coalesce(r.address, ''), '^.*,', ''))) as ultimo,
      coalesce(
        (select c.label from public.poi_tags t join public.poi_categories c on c.id = t.category_id
          where t.slug = r.type::text limit 1),
        'Outros') as padrao
  ) x
  where r.category in ('No Paraguai', 'Na Argentina')
), mudou as (
  select * from alvo where new_cat is distinct from old_cat
), bkp as (
  insert into public.recs_category_repair_20260924 (tbl, row_id, old_category, new_category)
  select 'city_references', id, old_cat, new_cat from mudou
  returning row_id
)
update public.city_references r
set category = m.new_cat
from mudou m
where r.id = m.id;

-- 3) "Aqui pertinho" (property_recommendations) — até 2 km do imóvel, sempre
--    no mesmo país: volta para a categoria padrão do tipo.
with alvo as (
  select
    r.id,
    r.category as old_cat,
    coalesce(
      (select c.label from public.poi_tags t join public.poi_categories c on c.id = t.category_id
        where t.slug = r.type::text limit 1),
      'Outros') as new_cat
  from public.property_recommendations r
  where r.category in ('No Paraguai', 'Na Argentina')
), mudou as (
  select * from alvo where new_cat is distinct from old_cat
), bkp as (
  insert into public.recs_category_repair_20260924 (tbl, row_id, old_category, new_category)
  select 'property_recommendations', id, old_cat, new_cat from mudou
  returning row_id
)
update public.property_recommendations r
set category = m.new_cat
from mudou m
where r.id = m.id;

-- 4) "Aqui pertinho" repetido (mesmo guia, mesmo lugar do Google) — fica a
--    primeira ocorrência; a linha removida vai inteira para o backup.
create table if not exists public.recs_dedupe_backup_20260924 (
  row_data jsonb not null,
  removed_at timestamptz not null default now()
);
alter table public.recs_dedupe_backup_20260924 enable row level security;

with dup as (
  select id from (
    select id, row_number() over (partition by property_id, scope, place_id order by position, id) as n
    from public.property_recommendations
    where place_id is not null
  ) z where z.n > 1
), bkp as (
  insert into public.recs_dedupe_backup_20260924 (row_data)
  select to_jsonb(r) from public.property_recommendations r where r.id in (select id from dup)
  returning 1
)
delete from public.property_recommendations r where r.id in (select id from dup);

-- ROLLBACK (manual, se precisar):
-- insert into public.property_recommendations
--   select (jsonb_populate_record(null::public.property_recommendations, row_data)).*
--   from public.recs_dedupe_backup_20260924;
-- update public.city_references r set category = b.old_category
--   from public.recs_category_repair_20260924 b where b.tbl = 'city_references' and b.row_id = r.id;
-- update public.property_recommendations r set category = b.old_category
--   from public.recs_category_repair_20260924 b where b.tbl = 'property_recommendations' and b.row_id = r.id;
-- update public.poi_categories set label = 'No Paraguai' where slug = 'compras';
