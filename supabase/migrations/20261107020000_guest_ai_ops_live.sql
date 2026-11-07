-- ConciergeIA Guest AI · GATE G2c — AÇÃO REAL NOS CARDS (decisão do titular, 06/11/2026: sem período de
-- observação). Aditiva sobre a G2a (`20261107010000_guest_ai_ops_actions.sql`, já aplicada).
--
-- A auditoria passa a aceitar o modo `live`:
--   · mode    ∈ ('shadow', 'live')
--   · outcome ∈ ('would_apply', 'claimed', 'applied', 'refused')
--       shadow ⇒ would_apply | refused         (observação, nada é escrito em card)
--       live   ⇒ claimed → applied | refused   (`claimed` é a reserva da ação ANTES da escrita: reentrega do
--                                              webhook ou geração repetida nunca aplica duas vezes; uma linha
--                                              que fica em `claimed` indica escrita interrompida)
-- Novas colunas: `card_after` (foto do card depois da ação) e `applied_at`.
-- Nova ação `late_checkout` (diretriz de 06/11/2026, item 3): concessão EXPRESSA de horário de saída estendido
-- feita por atendente humano no chat. A evidência é a mensagem da EQUIPE (`role='assistant'`,
-- `sender_type='human'`, sem nota interna) — pedido do hóspede nunca serve; uma concessão é auditada uma vez só
-- (único por mensagem da equipe), por mais turnos do hóspede que venham depois. A escrita no card é feita pelo
-- servidor com `internal_set_late_checkout` em nome do atendente (o trigger R6 confere a permissão).
-- RPCs (todas SECURITY DEFINER, search_path fixo, EXECUTE só service_role):
--   · guest_ai_ops_record  — mesma assinatura; agora aceita `live` só com `refused` (recusa da política)
--   · guest_ai_ops_claim   — reserva a ação (`live`, `claimed`), idempotente por mensagem + ação
--   · guest_ai_ops_finish  — encerra a reserva com `applied` (foto depois) ou `refused` (motivo)
-- A escrita nos cards NÃO acontece no banco: é feita pelo servidor com as rotinas oficiais do painel.
-- Sem cron, sem pg_net, sem chamada externa.

do $pre$
begin
  if to_regclass('public.guest_ai_ops_actions') is null
     or to_regprocedure('public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)') is null then
    raise exception 'GUEST_AI_OPS_LIVE_PRE: G2a não aplicada; nada foi alterado';
  end if;
end $pre$;

alter table public.guest_ai_ops_actions add column if not exists card_after jsonb;
alter table public.guest_ai_ops_actions add column if not exists applied_at timestamptz;

-- troca das checagens de modo/desfecho (nomes automáticos da G2a) pelas novas, com coerência entre os dois
do $chk$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.guest_ai_ops_actions'::regclass and contype = 'c'
       and (pg_get_constraintdef(oid) ilike '%mode%= ANY%' or pg_get_constraintdef(oid) ilike '%(mode = %'
            or pg_get_constraintdef(oid) ilike '%outcome%= ANY%' or pg_get_constraintdef(oid) ilike '%(outcome = %')
       and conname not in ('guest_ai_ops_actions_code_when_refused', 'guest_ai_ops_actions_mode_outcome', 'guest_ai_ops_actions_card_after_shape')
  loop
    execute format('alter table public.guest_ai_ops_actions drop constraint %I', r.conname);
  end loop;
end $chk$;

-- vocabulário de ações (+ late_checkout): troca da checagem automática da G2a por uma nomeada
do $act$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.guest_ai_ops_actions'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%action = ANY%'
       and conname not in ('guest_ai_ops_actions_action', 'guest_ai_ops_actions_eta_fields', 'guest_ai_ops_actions_madrugada')
  loop
    execute format('alter table public.guest_ai_ops_actions drop constraint %I', r.conname);
  end loop;
end $act$;
alter table public.guest_ai_ops_actions drop constraint if exists guest_ai_ops_actions_action;
alter table public.guest_ai_ops_actions add constraint guest_ai_ops_actions_action check (
  action in ('eta_checkin', 'eta_checkout', 'checkin_done', 'checkout_done', 'early_departure', 'late_checkout')
);
-- data/hora: previsão (eta_*) e late checkout (dia da saída + horário concedido); saída antecipada só a data
alter table public.guest_ai_ops_actions drop constraint if exists guest_ai_ops_actions_eta_fields;
alter table public.guest_ai_ops_actions add constraint guest_ai_ops_actions_eta_fields check (
  (action in ('eta_checkin', 'eta_checkout', 'late_checkout'))
  or (action = 'early_departure' and proposed_time is null)
  or (proposed_date is null and proposed_time is null)
);
-- uma concessão da equipe ⇒ no máximo um registro, qualquer que seja o turno que a encontrou
create unique index if not exists guest_ai_ops_actions_one_per_staff_grant
  on public.guest_ai_ops_actions (evidence_message_id, action) where action = 'late_checkout';

alter table public.guest_ai_ops_actions drop constraint if exists guest_ai_ops_actions_mode_outcome;
alter table public.guest_ai_ops_actions add constraint guest_ai_ops_actions_mode_outcome check (
  (mode = 'shadow' and outcome in ('would_apply', 'refused'))
  or (mode = 'live' and outcome in ('claimed', 'applied', 'refused'))
);
alter table public.guest_ai_ops_actions drop constraint if exists guest_ai_ops_actions_card_after_shape;
alter table public.guest_ai_ops_actions add constraint guest_ai_ops_actions_card_after_shape check (
  (card_after is null or jsonb_typeof(card_after) = 'object')
  and ((outcome = 'applied') = (applied_at is not null))
);

-- registro de recusa (shadow e live) e de observação (shadow) — mesma assinatura da G2a
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
  if p_mode not in ('shadow', 'live') then
    return jsonb_build_object('result', 'invalid', 'reason', 'mode');
  end if;
  -- ação aplicada só pelo par claim/finish (nunca registrada direto como `applied`)
  if p_mode = 'live' and p_outcome <> 'refused' then
    return jsonb_build_object('result', 'invalid', 'reason', 'outcome');
  end if;
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;
  -- evidência: do hóspede; no late checkout, da equipe humana (nunca do hóspede, da IA ou nota interna)
  if p_evidence_message_id is not null and not exists (
       select 1 from public.property_chat_messages m
        where m.id = p_evidence_message_id and m.conversation_id = p_conversation_id
          and coalesce(m.is_internal_note, false) = false
          and ((p_action <> 'late_checkout' and m.role = 'user')
               or (p_action = 'late_checkout' and m.role = 'assistant' and m.sender_type::text = 'human'))) then
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
    on conflict do nothing
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid', 'reason', 'values');
  end;
  if v_id is null then return jsonb_build_object('result', 'exists'); end if;
  return jsonb_build_object('result', 'recorded', 'id', v_id);
end $$;

-- reserva da ação real (antes da escrita no card)
create or replace function public.guest_ai_ops_claim(
  p_tenant_id uuid, p_property_id uuid, p_conversation_id uuid, p_trigger_message_id uuid,
  p_reservation_id uuid, p_suggestion_id uuid, p_action text, p_evidence_message_id uuid,
  p_proposed_date date, p_proposed_time text, p_madrugada boolean, p_card_before jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null or p_property_id is null or p_conversation_id is null or p_trigger_message_id is null
     or p_reservation_id is null or p_action is null or p_evidence_message_id is null then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;
  if not exists (
       select 1 from public.property_chat_messages m
        where m.id = p_evidence_message_id and m.conversation_id = p_conversation_id
          and coalesce(m.is_internal_note, false) = false
          and ((p_action <> 'late_checkout' and m.role = 'user')
               or (p_action = 'late_checkout' and m.role = 'assistant' and m.sender_type::text = 'human'))) then
    return jsonb_build_object('result', 'invalid', 'reason', 'evidence');
  end if;
  if not exists (select 1 from public.property_reservations r where r.id = p_reservation_id and r.property_id = p_property_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'reservation');
  end if;
  begin
    insert into public.guest_ai_ops_actions
      (tenant_id, property_id, conversation_id, trigger_message_id, reservation_id, suggestion_id, action, mode,
       outcome, code, evidence_message_id, proposed_date, proposed_time, madrugada, card_before)
    values
      (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_reservation_id, p_suggestion_id, p_action, 'live',
       'claimed', null, p_evidence_message_id, p_proposed_date, nullif(p_proposed_time, ''), coalesce(p_madrugada, false),
       coalesce(p_card_before, '{}'::jsonb))
    on conflict do nothing
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid', 'reason', 'values');
  end;
  if v_id is null then return jsonb_build_object('result', 'exists'); end if;
  return jsonb_build_object('result', 'claimed', 'id', v_id);
end $$;

-- encerramento da ação reservada: aplicada (com a foto depois) ou recusada (motivo fechado)
create or replace function public.guest_ai_ops_finish(p_id uuid, p_outcome text, p_code text, p_card_after jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_id is null or p_outcome is null or p_outcome not in ('applied', 'refused') then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  begin
    update public.guest_ai_ops_actions
       set outcome = p_outcome,
           code = case when p_outcome = 'refused' then nullif(p_code, '') else null end,
           card_after = case when p_card_after is null then null else p_card_after end,
           applied_at = case when p_outcome = 'applied' then now() else null end
     where id = p_id and mode = 'live' and outcome = 'claimed'
    returning id into v_id;
  exception when check_violation then
    return jsonb_build_object('result', 'invalid', 'reason', 'values');
  end;
  if v_id is null then return jsonb_build_object('result', 'invalid_state'); end if;
  return jsonb_build_object('result', 'finished', 'id', v_id);
end $$;

revoke all on function public.guest_ai_ops_claim(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, date, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.guest_ai_ops_finish(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.guest_ai_ops_claim(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, date, text, boolean, jsonb) to service_role;
grant execute on function public.guest_ai_ops_finish(uuid, text, text, jsonb) to service_role;

do $post$
declare
  f text;
begin
  foreach f in array array[
      'public.guest_ai_ops_record(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, uuid, date, text, boolean, jsonb)',
      'public.guest_ai_ops_claim(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid, date, text, boolean, jsonb)',
      'public.guest_ai_ops_finish(uuid, text, text, jsonb)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'GUEST_AI_OPS_LIVE_POS: privilégio inesperado em %', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.guest_ai_ops_actions', 'INSERT')
     or has_table_privilege('authenticated', 'public.guest_ai_ops_actions', 'UPDATE')
     or has_table_privilege('anon', 'public.guest_ai_ops_actions', 'SELECT') then
    raise exception 'GUEST_AI_OPS_LIVE_POS: privilégio inesperado em guest_ai_ops_actions';
  end if;
end $post$;
