-- G2c · ESCRITAS INTERROMPIDAS: ações reservadas (`claimed`) há mais de 5 minutos sem desfecho. SOMENTE LEITURA.
-- Uma linha aqui significa que o servidor reservou a ação e não registrou se o card foi movido (ex.: processo
-- encerrado no meio). Confira o card pelo id da reserva antes de qualquer ação manual.
select
  a.created_at,
  p.name                       as imovel,
  a.action                     as acao,
  a.reservation_id,
  a.conversation_id,
  a.card_before ->> 'status'   as card_status_antes
from public.guest_ai_ops_actions a
left join public.properties p on p.id = a.property_id
where a.mode = 'live' and a.outcome = 'claimed' and a.created_at < now() - interval '5 minutes'
order by a.created_at desc;
