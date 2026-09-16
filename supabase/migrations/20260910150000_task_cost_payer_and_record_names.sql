-- 1) QUEM PAGA A RESOLUÇÃO (pedido explícito, 10/09/2026).
--
-- `resolved_by_provider_id` já dizia QUEM RESOLVEU; faltava dizer QUEM ARCA
-- com o custo, que nem sempre é a mesma pessoa: um dano causado pelo hóspede
-- pode ser consertado pelo prestador e cobrado do proprietário, ou absorvido
-- pela própria empresa.
alter table public.tasks
  add column if not exists cost_payer text
    check (cost_payer is null or cost_payer in ('company','owner','provider')),
  add column if not exists cost_payer_id uuid;

comment on column public.tasks.cost_payer is
  'Quem arca com o custo da resolução: company (a própria empresa), owner (proprietário do imóvel) ou provider (o prestador). Null = sem custo ou não informado.';
comment on column public.tasks.cost_payer_id is
  'Id do proprietário (property_owners) ou do prestador (service_providers) quando cost_payer não é company.';

-- 2) NOME DOS REGISTROS: 10 primeiras letras do anúncio + sequencial por
-- imóvel (STUDIO101-01). O nome do arquivo original vinha da câmera do
-- celular ("17890533261888326086821345931428.jpg") e não dizia nada.
--
-- `file_name` é só rótulo — a chave real do arquivo é `storage_path`, que
-- NÃO é tocado aqui. Nada quebra no storage nem nos links já assinados.
with base as (
  select r.id,
         upper(regexp_replace(
           translate(left(coalesce(p.name, 'REGISTRO'), 10),
                     'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                     'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
           '[^A-Za-z0-9]', '', 'g')) || '-' ||
         lpad((row_number() over (partition by r.property_id order by r.created_at, r.id))::text, 2, '0') as novo
  from public.reservation_records r
  join public.properties p on p.id = r.property_id
)
update public.reservation_records r
set file_name = base.novo
from base
where base.id = r.id;
