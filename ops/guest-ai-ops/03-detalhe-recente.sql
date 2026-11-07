-- G2a/G2b · últimos 100 registros, para auditoria caso a caso. SOMENTE LEITURA.
-- Para ler a mensagem que serviu de evidência, abra a conversa no painel pelo id (a auditoria não guarda texto).
select
  a.created_at,
  p.name                                       as imovel,
  a.action                                     as acao,
  a.outcome                                    as desfecho,
  a.code                                       as motivo,
  a.proposed_date                              as data_proposta,
  a.proposed_time                              as hora_proposta,
  a.madrugada,
  a.card_before ->> 'exists'                   as card_existia,
  a.card_before ->> 'status'                   as card_status_antes,
  a.card_before ->> 'arrivalTimeOverride'      as previsao_antes,
  a.card_before ->> 'arrivalTimeSource'        as origem_previsao_antes,
  a.conversation_id,
  a.evidence_message_id,
  a.reservation_id,
  a.suggestion_id
from public.guest_ai_ops_actions a
left join public.properties p on p.id = a.property_id
order by a.created_at desc
limit 100;
