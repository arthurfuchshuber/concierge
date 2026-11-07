-- ConciergeIA Guest AI · GATE G1a — BLINDAGEM DO COPILOTO (parte ADITIVA; decisão do titular, 06/11/2026).
--
-- Aplicar ANTES do merge do PR do G1. Não remove nem altera permissão de nada que a versão atual do app usa:
-- as RPCs antigas (`copilot_edit`, `copilot_discard`, `copilot_claim_send`, `copilot_finish_send`,
-- `copilot_reconcile_send`, autoria por `auth.uid()`, EXECUTE para `authenticated`) continuam funcionando até
-- a parte G1b (`ops/copilot-g1/g1b-revoke-legacy.sql`), aplicada só DEPOIS de o código novo estar no ar.
--
-- 1. Ações do atendente com o ATOR EXPLÍCITO (`copilot_actor_*`), EXECUTE só para `service_role`. O servidor
--    (Server Functions do TanStack Start) valida a sessão e passa `p_actor` = usuário da sessão. As regras são
--    as mesmas das RPCs antigas, aplicadas sobre `p_actor`: acesso ao imóvel (`guest_ai_copilot_lock_for_actor`),
--    permissão `chat_respond` no banco, token de envio e janela de 2 minutos.
-- 2. `copilot_actor_finish_send` ESTRITO: `sent` só com uma mensagem da MESMA conversa, gravada pelo MESMO ator,
--    não falhada, não nota interna e posterior à reivindicação do envio. Fecha a falsificação da trilha.
-- 3. `copilot_claim_generation` (mesma assinatura ⇒ `create or replace` preserva dono, ACL e SECURITY DEFINER):
--    · sugestões presas em `generating` há mais de 90 s (de outras mensagens, ou já sem tentativas) viram
--      `generation_failed` / `technical_error` / `generation_timeout` — oportunista, limitado a 200, sem cron;
--    · a mesma mensagem continua podendo ser reivindicada de novo depois de 90 s (até 10 tentativas);
--    · teto diário: a geração interrompida por timeout CONTINUA contando pelo pior caso do turno (o custo real
--      é desconhecido: o modelo pode ter sido chamado antes da interrupção). Sem custo presumido zero.
-- Nada aqui agenda, ativa ou chama serviço externo. Sem `cron.`, sem `pg_net`.

do $pre$
begin
  if to_regclass('public.guest_ai_copilot_suggestions') is null
     or to_regprocedure('public.guest_ai_copilot_lock_for_actor(uuid, uuid)') is null
     or to_regprocedure('public.guest_ai_copilot_summary(public.guest_ai_copilot_suggestions)') is null
     or to_regprocedure('public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)') is null
     or to_regprocedure('public.has_member_permission(uuid, uuid, public.member_permission)') is null then
    raise exception 'COPILOT_G1A_PRE: estrutura do Copiloto ausente; nada foi alterado';
  end if;
end $pre$;

-- ───────────── 1. Reivindicação da geração: expiração de presas + teto com timeout pelo pior caso ─────────────
create or replace function public.copilot_claim_generation(
  p_tenant_id uuid, p_property_id uuid, p_conversation_id uuid, p_trigger_message_id uuid, p_surface text,
  p_daily_cost_limit_usd numeric, p_turn_cost_ceiling_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_spent numeric;
  v_day_start timestamptz;
begin
  if p_tenant_id is null or p_property_id is null or p_conversation_id is null or p_trigger_message_id is null
     or p_surface is null or p_surface not in ('guide_chat', 'whatsapp', 'airbnb')
     or (p_daily_cost_limit_usd is not null and p_daily_cost_limit_usd <= 0)
     or p_turn_cost_ceiling_usd is null or p_turn_cost_ceiling_usd <= 0 or p_turn_cost_ceiling_usd > 0.15 then
    return jsonb_build_object('result', 'invalid', 'reason', 'arguments');
  end if;
  -- coerência conversa ⇄ imóvel ⇄ tenant e mensagem ⇄ conversa (defesa em profundidade: o servidor já validou)
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;

  -- expurgo oportunista da retenção (limitado; sem cron)
  delete from public.guest_ai_copilot_suggestions
   where id in (select id from public.guest_ai_copilot_suggestions where expires_at <= now() limit 200);

  -- G1a: expiração oportunista de gerações presas (> 90 s). A da MESMA mensagem segue para nova tentativa
  -- abaixo, enquanto houver tentativas; esgotadas, também expira.
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'generation_failed', outcome_kind = 'technical_error',
         outcome_code = 'generation_timeout', generation_finished_at = now()
   where id in (
     select s.id from public.guest_ai_copilot_suggestions s
      where s.state = 'generating' and s.generation_started_at < now() - interval '90 seconds'
        and (not (s.conversation_id = p_conversation_id and s.trigger_message_id = p_trigger_message_id)
             or s.generation_attempts >= 10)
      limit 200
      for update skip locked);

  -- serializa reivindicações da mesma conversa
  perform pg_advisory_xact_lock(hashtext('guest_ai_copilot_conv'), hashtext(p_conversation_id::text));

  select * into r from public.guest_ai_copilot_suggestions
   where conversation_id = p_conversation_id and trigger_message_id = p_trigger_message_id for update;
  if found then
    if r.state = 'generating' and r.generation_started_at < now() - interval '90 seconds' and r.generation_attempts < 10 then
      update public.guest_ai_copilot_suggestions
         set updated_at = now(), generation_started_at = now(), generation_attempts = generation_attempts + 1
       where id = r.id returning * into r;
      return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', true);
    end if;
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'exists');
  end if;

  -- a mensagem nova torna obsoletas as sugestões ainda vivas da conversa
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'superseded'
   where conversation_id = p_conversation_id and state in ('generating', 'available', 'edited', 'no_suggestion', 'generation_failed');

  -- teto diário (dia em UTC). O servidor sempre envia um teto (padrão US$ 3,00); NULL continua aceito só por
  -- compatibilidade. Contam: custo gravado + gerações em curso e gerações interrompidas por timeout (sem custo
  -- conhecido), ambas pelo pior caso do turno.
  if p_daily_cost_limit_usd is not null then
  perform pg_advisory_xact_lock(hashtext('guest_ai_copilot_budget'));
  v_day_start := (date_trunc('day', now() at time zone 'UTC')) at time zone 'UTC';
  select coalesce(sum(gateway_cost_usd), 0)
         + coalesce(count(*) filter (where state = 'generating'
                                        or (outcome_code = 'generation_timeout' and gateway_cost_usd = 0)), 0) * p_turn_cost_ceiling_usd
    into v_spent
    from public.guest_ai_copilot_suggestions
   where generation_started_at >= v_day_start;
  if v_spent + p_turn_cost_ceiling_usd > p_daily_cost_limit_usd then
    insert into public.guest_ai_copilot_suggestions
      (tenant_id, property_id, conversation_id, trigger_message_id, surface, state, outcome_kind, outcome_code, generation_finished_at)
    values (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_surface, 'generation_failed', 'blocked', 'budget_daily_exceeded', now())
    returning * into r;
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'daily_budget_exceeded');
  end if;
  end if;

  insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface)
  values (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_surface)
  returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', false);
end $$;

-- ───────────── 2. Ações do atendente com ator explícito (só service_role) ─────────────
create or replace function public.copilot_actor_edit(p_actor uuid, p_suggestion_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
begin
  if p_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_text is null or length(btrim(p_text)) < 1 or length(p_text) > 4000 then return jsonb_build_object('result', 'invalid', 'reason', 'text'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, p_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.has_member_permission(p_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state not in ('available', 'edited', 'send_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), edited_text = case when p_text = suggested_text then null else p_text end,
         edited_by = p_actor, edited_at = now(), state = 'edited'
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'edited');
end $$;

create or replace function public.copilot_actor_discard(p_actor uuid, p_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
begin
  if p_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, p_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.has_member_permission(p_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state not in ('available', 'edited', 'send_failed', 'no_suggestion', 'generation_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'discarded', discarded_by = p_actor, discarded_at = now()
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'discarded');
end $$;

create or replace function public.copilot_actor_claim_send(p_actor uuid, p_suggestion_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_final text;
begin
  if p_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, p_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.has_member_permission(p_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state = 'sending' then
    if r.send_claimed_at > now() - interval '2 minutes' then
      return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'send_in_progress');
    end if;
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'send_unknown');
  end if;
  if r.state not in ('available', 'edited', 'send_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  v_final := coalesce(nullif(btrim(coalesce(p_text, '')), ''), r.edited_text, r.suggested_text);
  if v_final is null or length(v_final) > 4000 then return jsonb_build_object('result', 'invalid', 'reason', 'text'); end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), edited_text = case when v_final = suggested_text then null else v_final end,
         edited_by = case when v_final = coalesce(edited_text, suggested_text) then edited_by else p_actor end,
         edited_at = case when v_final = coalesce(edited_text, suggested_text) then edited_at else now() end,
         state = 'sending', send_token = gen_random_uuid(), send_claimed_at = now(), send_claimed_by = p_actor,
         send_attempts = send_attempts + 1, send_error = null
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'send_token', r.send_token);
end $$;

create or replace function public.copilot_actor_finish_send(
  p_actor uuid, p_suggestion_id uuid, p_send_token uuid, p_outcome text, p_message_id uuid,
  p_provider_message_id text, p_channel text, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
begin
  if p_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') then return jsonb_build_object('result', 'invalid', 'reason', 'outcome'); end if;
  if p_channel is not null and p_channel not in ('web', 'whatsapp', 'airbnb') then return jsonb_build_object('result', 'invalid', 'reason', 'channel'); end if;
  if p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then return jsonb_build_object('result', 'invalid', 'reason', 'error_code'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, p_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.has_member_permission(p_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state <> 'sending' then return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state'); end if;
  if r.send_token is null or p_send_token is null or r.send_token <> p_send_token or r.send_claimed_by <> p_actor then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'token_mismatch');
  end if;
  if p_outcome = 'sent' then
    if p_message_id is null then return jsonb_build_object('result', 'invalid', 'reason', 'message_id'); end if;
    -- G1a: a mensagem tem de ser desta conversa, deste ator, posterior à reivindicação, não falhada e não nota interna
    if not exists (
      select 1 from public.property_chat_messages pm
       where pm.id = p_message_id
         and pm.conversation_id = r.conversation_id
         and pm.sender_user_id = p_actor
         and pm.created_at >= r.send_claimed_at - interval '5 seconds'
         and coalesce(pm.delivery_status, 'sent') <> 'failed'
         and coalesce(pm.is_internal_note, false) = false) then
      return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid', 'reason', 'message_mismatch');
    end if;
    update public.guest_ai_copilot_suggestions
       set updated_at = now(), state = 'sent', sent_at = now(), sent_by = p_actor, sent_message_id = p_message_id,
           sent_provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 200), ''), sent_channel = p_channel,
           send_error = null, send_token = null
     where id = r.id returning * into r;
  else
    update public.guest_ai_copilot_suggestions
       set updated_at = now(), state = 'send_failed', send_error = coalesce(nullif(p_error_code, ''), 'send_failed'), sent_channel = p_channel, send_token = null
     where id = r.id returning * into r;
  end if;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'finished');
end $$;

create or replace function public.copilot_actor_reconcile_send(
  p_actor uuid, p_suggestion_id uuid, p_attempt_finished boolean default false, p_error_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  m record;
begin
  if p_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then return jsonb_build_object('result', 'invalid', 'reason', 'error_code'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, p_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if not public.has_member_permission(p_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state <> 'sending' then return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'nothing_to_reconcile'); end if;
  select pm.id, pm.external_id, pm.channel into m
    from public.property_chat_messages pm
   where pm.conversation_id = r.conversation_id
     and pm.sender_user_id = r.send_claimed_by
     and pm.created_at >= r.send_claimed_at - interval '5 seconds'
     and coalesce(pm.delivery_status, 'sent') <> 'failed'
     and coalesce(pm.is_internal_note, false) = false
   order by pm.created_at asc limit 1;
  if found then
    update public.guest_ai_copilot_suggestions
       set updated_at = now(), state = 'sent', sent_at = now(), sent_by = r.send_claimed_by, sent_message_id = m.id,
           sent_provider_message_id = nullif(left(coalesce(m.external_id, ''), 200), ''),
           sent_channel = case when m.channel in ('web', 'whatsapp', 'airbnb') then m.channel else null end,
           send_error = null, send_token = null
     where id = r.id returning * into r;
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'reconciled_sent');
  end if;
  if not coalesce(p_attempt_finished, false) and r.send_claimed_at > now() - interval '2 minutes' then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'send_in_progress');
  end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'send_failed',
         send_error = case when coalesce(p_attempt_finished, false) then coalesce(p_error_code, 'send_failed') else 'unknown_result' end,
         send_token = null
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', case when coalesce(p_attempt_finished, false) then 'reconciled_failed' else 'reconciled_unknown' end);
end $$;

-- ───────────── 3. Privilégios: as novas só para service_role ─────────────
revoke all on function public.copilot_actor_edit(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_actor_discard(uuid, uuid) from public, anon, authenticated;
revoke all on function public.copilot_actor_claim_send(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.copilot_actor_finish_send(uuid, uuid, uuid, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.copilot_actor_reconcile_send(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.copilot_actor_edit(uuid, uuid, text) to service_role;
grant execute on function public.copilot_actor_discard(uuid, uuid) to service_role;
grant execute on function public.copilot_actor_claim_send(uuid, uuid, text) to service_role;
grant execute on function public.copilot_actor_finish_send(uuid, uuid, uuid, text, uuid, text, text, text) to service_role;
grant execute on function public.copilot_actor_reconcile_send(uuid, uuid, boolean, text) to service_role;

-- ───────────── 4. Pós-verificação (falha ⇒ erro; a transação do editor desfaz) ─────────────
do $post$
declare
  f text;
begin
  foreach f in array array[
      'public.copilot_actor_edit(uuid, uuid, text)',
      'public.copilot_actor_discard(uuid, uuid)',
      'public.copilot_actor_claim_send(uuid, uuid, text)',
      'public.copilot_actor_finish_send(uuid, uuid, uuid, text, uuid, text, text, text)',
      'public.copilot_actor_reconcile_send(uuid, uuid, boolean, text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
       or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'COPILOT_G1A_POS: privilégio inesperado em %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)', 'EXECUTE') then
    raise exception 'COPILOT_G1A_POS: ACL de copilot_claim_generation alterada';
  end if;
end $post$;
