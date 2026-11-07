-- G2a/G2b · MONITORAMENTO das ações operacionais da IA (modo de observação). SOMENTE LEITURA.
-- Resumo por ação × desfecho × motivo nos últimos 14 dias (ajuste o intervalo na linha marcada).
-- Sem texto do hóspede: a tabela não guarda conteúdo de mensagem.
select
  a.action                                   as acao,
  a.outcome                                  as desfecho,
  coalesce(a.code, '—')                      as motivo,
  count(*)                                   as total,
  count(distinct a.property_id)              as imoveis,
  count(distinct a.reservation_id)           as reservas,
  count(*) filter (where a.madrugada)        as madrugada,
  min(a.created_at)                          as primeiro,
  max(a.created_at)                          as ultimo
from public.guest_ai_ops_actions a
where a.created_at >= now() - interval '14 days'   -- ← intervalo
group by 1, 2, 3
order by 1, 2, total desc;
