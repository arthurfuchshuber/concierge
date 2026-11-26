-- SITUAÇÃO REGIONAL · "usada em N conversas" com dado real (auditoria de 26/11/2026)
--
-- A faixa da situação ativa mostra em quantas conversas a IA USOU a situação. Até aqui o número contava toda
-- resposta da IA na cidade desde o início da situação, mesmo sobre outro assunto. Agora cada resposta que se
-- apoia no item da situação (citado no Documento Vivo) registra a conversa aqui, sem repetir.

alter table public.guest_ai_regional_situations
  add column if not exists used_conversation_ids uuid[] not null default '{}';

create or replace function public.guest_ai_regional_record_use(p_ids uuid[], p_conversation_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.guest_ai_regional_situations
     set used_conversation_ids = array_append(used_conversation_ids, p_conversation_id),
         updated_at = now()
   where id = any(p_ids)
     and status = 'active'
     and not (p_conversation_id = any(used_conversation_ids));
$$;

revoke all on function public.guest_ai_regional_record_use(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.guest_ai_regional_record_use(uuid[], uuid) to service_role;
