-- G2 · volume diário por modo, ação e desfecho (UTC). SOMENTE LEITURA.
select
  date_trunc('day', a.created_at)::date                      as dia,
  a.mode                                                     as modo,
  a.action                                                   as acao,
  count(*) filter (where a.outcome = 'applied')              as aplicou,
  count(*) filter (where a.outcome = 'would_apply')          as faria,
  count(*) filter (where a.outcome = 'refused')              as recusou,
  count(*) filter (where a.outcome = 'claimed')              as reservada,
  count(*)                                                   as total
from public.guest_ai_ops_actions a
where a.created_at >= now() - interval '30 days'
group by 1, 2, 3
order by 1 desc, 2, 3;
