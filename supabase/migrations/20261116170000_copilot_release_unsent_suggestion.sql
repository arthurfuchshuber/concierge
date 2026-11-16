-- A varredura pós-pausa precisa descartar a sugestão do copiloto gerada DURANTE a pausa (não enviada), porque o banco
-- só aceita uma geração por mensagem. O papel de serviço só tem SELECT na tabela (escrita só por funções definer),
-- então o descarte é uma função própria, restrita: só apaga sugestão NÃO enviada da mensagem indicada, criada antes
-- do instante informado. Devolve quantas linhas apagou.
create or replace function public.copilot_release_unsent_suggestion(
  p_conversation_id uuid, p_trigger_message_id uuid, p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare n integer;
begin
  if p_conversation_id is null or p_trigger_message_id is null or p_before is null then return 0; end if;
  delete from public.guest_ai_copilot_suggestions s
   where s.conversation_id = p_conversation_id
     and s.trigger_message_id = p_trigger_message_id
     and s.sent_at is null
     and s.created_at < p_before
     and s.state in ('available', 'edited', 'superseded', 'no_suggestion', 'generation_failed');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.copilot_release_unsent_suggestion(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.copilot_release_unsent_suggestion(uuid, uuid, timestamptz) to service_role;
