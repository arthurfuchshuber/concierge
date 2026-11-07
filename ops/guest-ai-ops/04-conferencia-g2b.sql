-- G2 · CONFERÊNCIA DE QUALIDADE das ações operacionais (critério D-G2-3: precisão ≥ 99%, zero baixa indevida).
-- SOMENTE LEITURA. Compara cada ação com o estado ATUAL do card correspondente:
--   · live / applied (a IA moveu o card):
--       conclusões      → o card continua concluído? Se voltou a pendente, a equipe desfez: POSSÍVEL BAIXA INDEVIDA;
--       previsões       → a previsão atual ainda é a da IA? Se a equipe gravou outra (`staff`), houve correção.
--       late checkout   → o card ainda tem o horário concedido pela equipe? Se mudou/sumiu, a equipe ajustou.
--   · shadow / would_apply (só observação):
--       conclusões      → o card foi concluído depois (pela equipe, pelo hóspede ou pelo auto-checkout)?
--       previsões       → a previsão atual do card é igual à proposta?
-- "desfeita"/"pendente" pede revisão caso a caso pela conversa (ids em 03-detalhe-recente.sql).
with base as (
  select
    a.*,
    case when a.action in ('checkin_done', 'eta_checkin') then 'checkin' else 'checkout' end as kind,
    a.action in ('checkin_done', 'checkout_done', 'early_departure') as is_done_action,
    a.action in ('eta_checkin', 'eta_checkout') as is_eta_action
  from public.guest_ai_ops_actions a
  where a.outcome in ('applied', 'would_apply')
), card as (
  select b.id, s.status, s.done_at, s.arrival_time_override, s.arrival_time_source, s.late_checkout_time
  from base b
  left join lateral (
    select g.status, g.done_at, g.arrival_time_override, g.arrival_time_source, g.late_checkout_time
      from public.guest_arrival_status g
     where g.reservation_id = b.reservation_id and g.kind = b.kind
     order by g.updated_at desc nulls last
     limit 1
  ) s on true
)
select
  b.mode                                                                              as modo,
  b.action                                                                            as acao,
  count(*)                                                                            as total,
  count(*) filter (where b.is_done_action and (c.status = 'done' or c.done_at is not null)) as concluido_agora,
  count(*) filter (where b.is_done_action and not (c.status = 'done' or c.done_at is not null)
                     and b.outcome = 'applied')                                        as desfeita_pela_equipe,
  count(*) filter (where b.is_done_action and not (c.status = 'done' or c.done_at is not null)
                     and b.outcome = 'would_apply')                                    as pendente_observacao,
  count(*) filter (where b.is_eta_action and c.arrival_time_override = b.proposed_time)  as previsao_mantida,
  count(*) filter (where b.is_eta_action and c.arrival_time_source = 'staff')         as previsao_corrigida_equipe,
  count(*) filter (where b.action = 'late_checkout' and c.late_checkout_time = b.proposed_time) as late_mantido,
  count(*) filter (where b.action = 'late_checkout' and c.late_checkout_time is distinct from b.proposed_time)
                                                                                      as late_ajustado_equipe,
  count(*) filter (where c.status is null)                                            as sem_card
from base b
join card c on c.id = b.id
group by b.mode, b.action
order by b.mode, b.action;
