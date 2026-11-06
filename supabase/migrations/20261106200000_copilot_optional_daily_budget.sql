-- Copiloto em operação comercial (decisão do titular, 06/11/2026):
-- `copilot_claim_generation`: o teto diário passa a ser OPCIONAL. `p_daily_cost_limit_usd` NULL ⇒ sem teto
--     diário; valor positivo ⇒ teto (sem o limite superior de US$ 1,00). O teto por turno (≤ 0,15) continua.
--     Mesma assinatura ⇒ `create or replace` preserva dono, ACL e SECURITY DEFINER.
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

  -- teto diário OPCIONAL (dia em UTC), contando gerações em curso pelo pior caso; NULL ⇒ sem teto diário
  if p_daily_cost_limit_usd is not null then
  perform pg_advisory_xact_lock(hashtext('guest_ai_copilot_budget'));
  v_day_start := (date_trunc('day', now() at time zone 'UTC')) at time zone 'UTC';
  select coalesce(sum(gateway_cost_usd), 0) + coalesce(count(*) filter (where state = 'generating'), 0) * p_turn_cost_ceiling_usd
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
