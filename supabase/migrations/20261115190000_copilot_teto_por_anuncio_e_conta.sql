-- TETO DE CUSTO POR ANÚNCIO E POR CONTA (decisão do proprietário, 15/11/2026). Substitui o teto diário GLOBAL único.
--  * Teto do anúncio (U): `p_daily_cost_limit_usd` passa a significar o teto diário POR ANÚNCIO (o servidor envia o padrão,
--    US$ 1,00). Exceção por anúncio: `property_listing_raw_data.ai_daily_cost_limit_usd` (nula = padrão).
--  * Teto da conta: soma dos tetos dos anúncios da conta com a IA ligada (`airbnb_ai_enabled`); no mínimo o teto do
--    anúncio que está sendo atendido. Contas diferentes NUNCA dividem orçamento (não existe mais teto entre contas).
--  * Elástico dentro da conta: um anúncio pode gastar acima do seu teto enquanto a conta estiver abaixo do dela, até
--    3× o teto do próprio anúncio (limite máximo por anúncio).
--  * Reserva por geração em curso/interrompida segue em US$ 0,15; dia em UTC; ao bater qualquer teto, o resultado
--    continua `daily_budget_exceeded` / `budget_daily_exceeded` (a conversa vai para a equipe, nunca em silêncio).
-- Mesma assinatura da função anterior (create or replace preserva grants). NULL em `p_daily_cost_limit_usd` segue
-- aceito só por compatibilidade (sem teto).

alter table public.property_listing_raw_data
  add column if not exists ai_daily_cost_limit_usd numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'property_listing_raw_data_ai_daily_cost_limit_chk') then
    alter table public.property_listing_raw_data
      add constraint property_listing_raw_data_ai_daily_cost_limit_chk
      check (ai_daily_cost_limit_usd is null or ai_daily_cost_limit_usd > 0);
  end if;
end $$;

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
  v_reserve numeric;
  v_unit numeric;
  v_account_cap numeric;
  v_account_spent numeric;
  v_listing_spent numeric;
begin
  if p_tenant_id is null or p_property_id is null or p_conversation_id is null or p_trigger_message_id is null
     or p_surface is null or p_surface not in ('guide_chat', 'whatsapp', 'airbnb')
     or (p_daily_cost_limit_usd is not null and p_daily_cost_limit_usd <= 0)
     or p_turn_cost_ceiling_usd is null or p_turn_cost_ceiling_usd <= 0 or p_turn_cost_ceiling_usd > 1 then
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

  -- teto por anúncio e por conta (dia em UTC). Contam: custo gravado + gerações em curso e gerações interrompidas
  -- por timeout (sem custo conhecido), pelo valor de reserva. A conta só enxerga o próprio gasto.
  if p_daily_cost_limit_usd is not null then
  v_reserve := least(p_turn_cost_ceiling_usd, 0.15);
  perform pg_advisory_xact_lock(hashtext('guest_ai_copilot_budget'), hashtext(p_tenant_id::text));
  v_day_start := (date_trunc('day', now() at time zone 'UTC')) at time zone 'UTC';
  -- teto do anúncio atendido (exceção própria ou o padrão)
  select coalesce(
           (select max(l.ai_daily_cost_limit_usd) from public.property_listing_raw_data l where l.property_id = p_property_id),
           p_daily_cost_limit_usd)
    into v_unit;
  -- teto da conta: soma dos tetos dos anúncios com a IA ligada; nunca menos que o do anúncio atendido
  select coalesce(sum(coalesce(x.lim, p_daily_cost_limit_usd)), 0)
    into v_account_cap
    from (select l.property_id, max(l.ai_daily_cost_limit_usd) as lim
            from public.property_listing_raw_data l
            join public.properties p on p.id = l.property_id
           where p.owner_id = p_tenant_id and l.airbnb_ai_enabled
           group by l.property_id) x;
  v_account_cap := greatest(v_account_cap, v_unit);
  select coalesce(sum(gateway_cost_usd), 0)
         + coalesce(count(*) filter (where state = 'generating'
                                        or (outcome_code = 'generation_timeout' and gateway_cost_usd = 0)), 0) * v_reserve,
         coalesce(sum(gateway_cost_usd) filter (where property_id = p_property_id), 0)
         + coalesce(count(*) filter (where property_id = p_property_id
                                        and (state = 'generating'
                                             or (outcome_code = 'generation_timeout' and gateway_cost_usd = 0))), 0) * v_reserve
    into v_account_spent, v_listing_spent
    from public.guest_ai_copilot_suggestions
   where tenant_id = p_tenant_id and generation_started_at >= v_day_start;
  if v_account_spent + v_reserve > v_account_cap or v_listing_spent + v_reserve > 3 * v_unit then
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

