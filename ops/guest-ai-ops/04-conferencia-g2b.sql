-- G2b · PRÉVIA DA MEDIÇÃO DE PRECISÃO (critério D-G2-3: ≥ 30 casos por ação, precisão ≥ 99%, zero baixa indevida).
-- SOMENTE LEITURA. Compara cada "faria" (would_apply) com o estado ATUAL do card correspondente, que a equipe,
-- o hóspede (guia) ou o auto-checkout movem no fluxo normal:
--   · checkin_done / checkout_done / early_departure → o card foi concluído depois? (concordância)
--   · eta_checkin / eta_checkout                     → a previsão atual do card é igual à proposta?
-- "pendente" = o card ainda não chegou ao estado esperado; precisa de revisão humana antes de virar falso positivo
-- (pode ser só atraso da equipe). A decisão final de precisão é do titular, caso a caso.
with base as (
  select
    a.*,
    case when a.action in ('checkin_done', 'eta_checkin') then 'checkin' else 'checkout' end as kind
  from public.guest_ai_ops_actions a
  where a.outcome = 'would_apply'
), card as (
  select b.id, s.status, s.done_at, s.arrival_time_override, s.arrival_time_source
  from base b
  left join lateral (
    select g.status, g.done_at, g.arrival_time_override, g.arrival_time_source
      from public.guest_arrival_status g
     where g.reservation_id = b.reservation_id and g.kind = b.kind
     order by g.updated_at desc nulls last
     limit 1
  ) s on true
)
select
  b.action                                                        as acao,
  count(*)                                                        as faria,
  count(*) filter (where b.action in ('checkin_done', 'checkout_done', 'early_departure')
                     and (c.status = 'done' or c.done_at is not null)
                     and c.done_at >= b.created_at - interval '6 hours') as concordou_conclusao,
  count(*) filter (where b.action in ('eta_checkin', 'eta_checkout')
                     and c.arrival_time_override = b.proposed_time)        as concordou_previsao,
  count(*) filter (where b.action in ('checkin_done', 'checkout_done', 'early_departure')
                     and not (c.status = 'done' or c.done_at is not null)) as pendente_conclusao,
  count(*) filter (where b.action in ('eta_checkin', 'eta_checkout')
                     and c.arrival_time_override is distinct from b.proposed_time) as divergiu_previsao,
  count(*) filter (where c.status is null)                        as sem_card
from base b
join card c on c.id = b.id
group by b.action
order by b.action;
