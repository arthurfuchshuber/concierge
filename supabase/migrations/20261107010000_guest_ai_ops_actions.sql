-- ConciergeIA Guest AI · GATE G2a — AUDITORIA DAS AÇÕES OPERACIONAIS DA IA (modo de observação).
--
-- Diretrizes do titular (06/11/2026): conclusão de check-in, conclusão de check-out (inclusive SAÍDA
-- ANTECIPADA, com o card de saída puxado para hoje) e previsão de horário informada pelo hóspede (com a
-- regra da MADRUGADA: 00:00–05:00 pertence à noite da data de entrada). Nesta etapa a IA NÃO escreve em card nenhum: só registra o que faria (`shadow`)
-- ou por que recusou. A tabela aceita apenas `mode = 'shadow'` e desfechos `would_apply`/`refused`; a
-- escrita nos cards (G2c/G2d) exigirá nova migration e nova homologação.
--
-- Acesso: RLS ligada; leitura pelos membros do imóvel (mesma regra das sugestões do Copiloto); nenhuma
-- escrita direta para anon/authenticated/service_role. Gravação só pela RPC `guest_ai_ops_record`
-- (SECURITY DEFINER, search_path fixo, EXECUTE só service_role), idempotente por mensagem + ação.
-- Sem texto do hóspede: só o id da mensagem com a evidência. Sem cron, sem pg_net, sem chamada externa.

do $pre$
begin
  if to_regclass('public.property_chat_conversations') is null
     or to_regclass('public.property_chat_messages') is null
     or to_regclass('public.properties') is null
     or to_regprocedure('public.user_can_access_property(uuid, uuid)') is null then
    raise exception 'GUEST_AI_OPS_PRE: estrutura base ausente; nada foi alterado';
  end if;
end $pre$;

create table if not exists public.guest_ai_ops_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null,
  trigger_message_id uuid not null,
  reservation_id uuid,
  suggestion_id uuid,
  action text not null check (action in ('eta_checkin', 'eta_checkout', 'checkin_done', 'checkout_done', 'early_departure')),
  mode text not null check (mode in ('shadow')),
  outcome text not null check (outcome in ('would_apply', 'refused')),
  code text check (code is null or code ~ '^[a-z][a-z0-9_]{0,63}$'),
  evidence_message_id uuid,
  proposed_date date,
  proposed_time text check (proposed_time is null or proposed_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  madrugada boolean not null default false,
  card_before jsonb not null default '{}'::jsonb check (jsonb_typeof(card_before) = 'object'),
  created_at timestamptz not null default now(),
  constraint guest_ai_ops_actions_one_per_message unique (trigger_message_id, action),
  constraint guest_ai_ops_actions_code_when_refused check ((outcome = 'refused') = (code is not null)),
  -- previsão: data e hora só em eta_*; saída antecipada: só a nova data do card (hoje); madrugada só na chegada
  constraint guest_ai_ops_actions_eta_fields check (
    (action in ('eta_checkin', 'eta_checkout'))
    or (action = 'early_departure' and proposed_time is null)
    or (proposed_date is null and proposed_time is null)
  ),
  constraint guest_ai_ops_actions_madrugada check (not madrugada or action = 'eta_checkin')
);
create index if not exists guest_ai_ops_actions_property_idx on public.guest_ai_ops_actions (property_id, created_at desc);
create index if not exists guest_ai_ops_actions_reservation_idx on public.guest_ai_ops_actions (reservation_id);

alter table public.guest_ai_ops_actions enable row level security;
revoke all on table public.guest_ai_ops_actions from public, anon, authenticated, service_role;
grant select on table public.guest_ai_ops_actions to authenticated;
drop policy if exists "ops: membros do imóvel leem a auditoria" on public.guest_ai_ops_actions;
create policy "ops: membros do imóvel leem a auditoria" on public.guest_ai_ops_actions
  for select to authenticated
  using (public.user_can_access_property(auth.uid(), property_id));

create or replace function public.guest_ai_ops_record(
  p_tenant_id uuid, p_property_id uuid, p_conversation_id uuid, p_trigger_message_id uuid,
  p_reservation_id uuid, p_suggestion_id uuid, p_action text, p_mode text, p_outcome text, p_code text,
  p_evidence_message_id uuid, p_proposed_date date, p_proposed_time text, p_madrugada boolean, p_card_before jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null or p_property_id is null or p_conversation_id is null or p_trigger_message_id is null
     or p_action is null or p_mode is null or p_outcome is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  if p_mode <> 'shadow' then
    -- G2a: só observação; qualquer outro modo é recusado no próprio banco
    return jsonb_build_object('result', 'invalid', 'reason', 'mode');
  end if;
  -- coerência conversa ⇄ imóvel ⇄ tenant, mensagem ⇄ conversa (do hóspede) e reserva ⇄ imóvel
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;
  if p_evidence_message_id is not null and not exists (
       select 1 from public.property_chat_messages m
        where m.id = p_evidence_message_id and m.conversation_id = p_conversation_id
          and m.role = 'user' and coalesce(m.is_internal_note, false) = false) then
    return jsonb_build_object('result', 'invalid', 'reason', 'evidence');
  end if;
  if p_reservation_id is not null and not exists (
       select 1 from public.property_reservations r where r.id = p_reservation_id and r.property_id = p_property_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'reservation');
  end if;
  begin
    insert into public.guest_ai_ops_actions
      (tenant_id, property_id, conversation_id, trigger_message_id, reservation_id, suggestion_id, action, mode,
       outcome, code, evidence_message_id, proposed_date, proposed_time, madrugada, card_before)
    values
      (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_reservation_id, p_suggestion_id, p_action, p_mode,
       p_outcome, nullif(p_code, ''), p_evidence_message_id, p_proposed_date, nullif(p_proposed_time, ''), coalesce(p_madrugada, false),
       coalesce(p_card_before, '{}'::jsonb))
    on conflict (trigger_message_id, action) do nothing
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid', 'reason', 'values');
  end;
  if v_id is null then return jsonb_build_object('result', 'exists'); end if;
  return jsonb_build_object('result', 'recorded', 'id', v_id);
end $$;

revoke all on function public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)
  to service_role;

do $post$
begin
  if has_function_privilege('anon', 'public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)', 'EXECUTE') then
    raise exception 'GUEST_AI_OPS_POS: privilégio inesperado em guest_ai_ops_record';
  end if;
  if has_table_privilege('authenticated', 'public.guest_ai_ops_actions', 'INSERT')
     or has_table_privilege('authenticated', 'public.guest_ai_ops_actions', 'UPDATE')
     or has_table_privilege('authenticated', 'public.guest_ai_ops_actions', 'DELETE')
     or has_table_privilege('anon', 'public.guest_ai_ops_actions', 'SELECT') then
    raise exception 'GUEST_AI_OPS_POS: privilégio inesperado em guest_ai_ops_actions';
  end if;
end $post$;
