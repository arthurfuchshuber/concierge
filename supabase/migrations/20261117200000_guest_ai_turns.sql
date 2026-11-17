-- TURNOS DA IA DE ATENDIMENTO (17/11/2026). Uma linha por mensagem do hóspede que a IA avaliou: estado da geração,
-- resposta, decisão (intenções, estratégia, encaminhamento), contexto usado e custo. Gravação só pelas funções
-- abaixo (security definer, service_role); leitura pelos membros do imóvel, por 14 dias (`expires_at`).
-- Idempotente.

create table if not exists public.guest_ai_turns (
  id uuid not null default gen_random_uuid() primary key,
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null,
  trigger_message_id uuid not null,
  surface text not null,
  state text not null default 'generating',
  suggested_text text,
  internal_question text,
  intents text[] not null default '{}',
  strategy text,
  handoff_needed boolean not null default false,
  handoff_urgency text,
  outcome_kind text,
  outcome_code text,
  warnings text[] not null default '{}',
  context_stay_phase text,
  context_reservation_linked boolean,
  context_history_messages integer,
  context_dossier_entries integer,
  context_credential_policy text,
  context_sender_identity text,
  context_human_in_command boolean,
  model_id text,
  gateway_input_tokens integer,
  gateway_output_tokens integer,
  gateway_cost_usd numeric(14,8) not null default 0,
  gateway_latency_ms integer,
  gateway_error text,
  generation_attempts integer not null default 1,
  generation_started_at timestamptz not null default now(),
  generation_finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.guest_ai_turns'::regclass and conname = 'guest_ai_turns_one_per_trigger') then
    alter table public.guest_ai_turns
      add constraint guest_ai_turns_one_per_trigger unique (conversation_id, trigger_message_id),
      add constraint guest_ai_turns_surface_check check (surface in ('guide_chat', 'whatsapp', 'airbnb')),
      add constraint guest_ai_turns_state_check check (state in ('generating', 'available', 'no_suggestion', 'generation_failed', 'superseded')),
      add constraint guest_ai_turns_text_when_available check (state <> 'available' or suggested_text is not null),
      add constraint guest_ai_turns_suggested_text_check check (suggested_text is null or (length(suggested_text) between 1 and 4000)),
      add constraint guest_ai_turns_internal_question_check check (internal_question is null or (length(internal_question) between 1 and 1000)),
      add constraint guest_ai_turns_intents_check check (intents <@ array['acknowledgment', 'informational_query', 'operational_request', 'problem_report', 'emergency', 'formal_change_request', 'arrival_confirmation', 'departure_confirmation', 'other']),
      add constraint guest_ai_turns_strategy_check check (strategy is null or strategy in ('answer', 'clarify', 'guide', 'suggest_alternatives', 'handoff', 'answer_and_handoff', 'silence')),
      add constraint guest_ai_turns_handoff_urgency_check check (handoff_urgency is null or handoff_urgency in ('low', 'normal', 'high')),
      add constraint guest_ai_turns_outcome_kind_check check (outcome_kind is null or outcome_kind in ('reply', 'silence', 'human_action', 'paused', 'urgent_internal_alert', 'refused', 'technical_error', 'blocked')),
      add constraint guest_ai_turns_outcome_code_check check (outcome_code is null or outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
      add constraint guest_ai_turns_warnings_check check (warnings <@ array['unknown_facts', 'source_conflicts', 'credential_request_denied', 'unauthorized_commitment', 'handoff_recommended', 'emergency', 'sender_identity_unresolved', 'human_in_command', 'reservation_not_linked', 'dossier_unavailable', 'history_unavailable', 'formal_change_request']),
      add constraint guest_ai_turns_context_stay_phase_check check (context_stay_phase is null or context_stay_phase in ('inquiry', 'pre_stay', 'in_stay', 'post_checkout', 'cancelled', 'no_show', 'unknown')),
      add constraint guest_ai_turns_context_history_messages_check check (context_history_messages is null or context_history_messages >= 0),
      add constraint guest_ai_turns_context_dossier_entries_check check (context_dossier_entries is null or context_dossier_entries >= 0),
      add constraint guest_ai_turns_context_credential_policy_check check (context_credential_policy is null or context_credential_policy in ('allow', 'deny')),
      add constraint guest_ai_turns_context_sender_identity_check check (context_sender_identity is null or context_sender_identity in ('resolved', 'unavailable', 'ambiguous', 'invalid', 'not_applicable', 'not_evaluated')),
      add constraint guest_ai_turns_model_id_check check (model_id is null or model_id ~ '^[a-z0-9][a-z0-9./_-]{0,63}$'),
      add constraint guest_ai_turns_gateway_input_tokens_check check (gateway_input_tokens is null or gateway_input_tokens >= 0),
      add constraint guest_ai_turns_gateway_output_tokens_check check (gateway_output_tokens is null or gateway_output_tokens >= 0),
      add constraint guest_ai_turns_gateway_cost_usd_check check (gateway_cost_usd >= 0),
      add constraint guest_ai_turns_gateway_latency_ms_check check (gateway_latency_ms is null or gateway_latency_ms >= 0),
      add constraint guest_ai_turns_gateway_error_check check (gateway_error is null or gateway_error ~ '^[a-z][a-z0-9_]{0,63}$'),
      add constraint guest_ai_turns_generation_attempts_check check (generation_attempts between 1 and 10);
  end if;
end $$;

create index if not exists guest_ai_turns_conv_idx on public.guest_ai_turns (conversation_id, created_at desc);
create index if not exists guest_ai_turns_expires_idx on public.guest_ai_turns (expires_at);
create index if not exists guest_ai_turns_budget_idx on public.guest_ai_turns (generation_started_at);

alter table public.guest_ai_turns enable row level security;
do $$
declare p text;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'guest_ai_turns' loop
    execute format('drop policy %I on public.guest_ai_turns', p);
  end loop;
end $$;
create policy "ia: membros do imóvel leem turnos vigentes" on public.guest_ai_turns
  for select to authenticated using (expires_at > now() and public.user_can_access_property(auth.uid(), property_id));
revoke all on public.guest_ai_turns from public, anon, authenticated, service_role;
grant select on public.guest_ai_turns to authenticated, service_role;

-- Teto diário por anúncio: exceção opcional no próprio anúncio (nula = padrão do servidor).
alter table public.property_listing_raw_data
  add column if not exists ai_daily_cost_limit_usd numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'property_listing_raw_data_ai_daily_cost_limit_chk') then
    alter table public.property_listing_raw_data
      add constraint property_listing_raw_data_ai_daily_cost_limit_chk
      check (ai_daily_cost_limit_usd is null or ai_daily_cost_limit_usd > 0);
  end if;
end $$;

create or replace function public.guest_ai_turn_summary(r public.guest_ai_turns)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'suggestion_id', r.id, 'state', r.state, 'conversation_id', r.conversation_id, 'property_id', r.property_id,
    'tenant_id', r.tenant_id, 'surface', r.surface, 'trigger_message_id', r.trigger_message_id,
    'text', r.suggested_text, 'generation_attempts', r.generation_attempts);
$$;

-- Reivindica a geração de UMA mensagem (uma linha por mensagem), com teto diário por anúncio e por conta.
create or replace function public.guest_ai_claim_turn(
  p_tenant_id uuid, p_property_id uuid, p_conversation_id uuid, p_trigger_message_id uuid, p_surface text,
  p_daily_cost_limit_usd numeric, p_turn_cost_ceiling_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_turns;
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
  if not exists (select 1 from public.property_chat_conversations c join public.properties p on p.id = c.property_id
                 where c.id = p_conversation_id and c.property_id = p_property_id and p.owner_id = p_tenant_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'scope');
  end if;
  if not exists (select 1 from public.property_chat_messages m where m.id = p_trigger_message_id and m.conversation_id = p_conversation_id) then
    return jsonb_build_object('result', 'invalid', 'reason', 'message');
  end if;

  delete from public.guest_ai_turns
   where id in (select id from public.guest_ai_turns where expires_at <= now() limit 200);

  update public.guest_ai_turns
     set updated_at = now(), state = 'generation_failed', outcome_kind = 'technical_error',
         outcome_code = 'generation_timeout', generation_finished_at = now()
   where id in (
     select s.id from public.guest_ai_turns s
      where s.state = 'generating' and s.generation_started_at < now() - interval '90 seconds'
        and (not (s.conversation_id = p_conversation_id and s.trigger_message_id = p_trigger_message_id)
             or s.generation_attempts >= 10)
      limit 200
      for update skip locked);

  perform pg_advisory_xact_lock(hashtext('guest_ai_turns_conv'), hashtext(p_conversation_id::text));

  select * into r from public.guest_ai_turns
   where conversation_id = p_conversation_id and trigger_message_id = p_trigger_message_id for update;
  if found then
    if r.state = 'generating' and r.generation_started_at < now() - interval '90 seconds' and r.generation_attempts < 10 then
      update public.guest_ai_turns
         set updated_at = now(), generation_started_at = now(), generation_attempts = generation_attempts + 1
       where id = r.id returning * into r;
      return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', true);
    end if;
    return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'exists');
  end if;

  update public.guest_ai_turns
     set updated_at = now(), state = 'superseded'
   where conversation_id = p_conversation_id and state in ('generating', 'available', 'no_suggestion', 'generation_failed');

  if p_daily_cost_limit_usd is not null then
    v_reserve := least(p_turn_cost_ceiling_usd, 0.15);
    perform pg_advisory_xact_lock(hashtext('guest_ai_turns_budget'), hashtext(p_tenant_id::text));
    v_day_start := (date_trunc('day', now() at time zone 'UTC')) at time zone 'UTC';
    select coalesce(
             (select max(l.ai_daily_cost_limit_usd) from public.property_listing_raw_data l where l.property_id = p_property_id),
             p_daily_cost_limit_usd)
      into v_unit;
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
      from public.guest_ai_turns
     where tenant_id = p_tenant_id and generation_started_at >= v_day_start;
    if v_account_spent + v_reserve > v_account_cap or v_listing_spent + v_reserve > 3 * v_unit then
      insert into public.guest_ai_turns
        (tenant_id, property_id, conversation_id, trigger_message_id, surface, state, outcome_kind, outcome_code, generation_finished_at)
      values (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_surface, 'generation_failed', 'blocked', 'budget_daily_exceeded', now())
      returning * into r;
      return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'daily_budget_exceeded');
    end if;
  end if;

  insert into public.guest_ai_turns (tenant_id, property_id, conversation_id, trigger_message_id, surface)
  values (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_surface)
  returning * into r;
  return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', false);
end $$;

create or replace function public.guest_ai_turn_state(p_suggestion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('state', s.state, 'generation_attempts', s.generation_attempts) from public.guest_ai_turns s where s.id = p_suggestion_id),
    jsonb_build_object('state', 'missing', 'generation_attempts', 0));
$$;

create or replace function public.guest_ai_store_turn(
  p_suggestion_id uuid, p_attempt integer, p_state text, p_text text, p_internal_question text, p_intents text[],
  p_strategy text, p_handoff_needed boolean, p_handoff_urgency text, p_outcome_kind text, p_outcome_code text,
  p_warnings text[], p_context_stay_phase text, p_context_reservation_linked boolean, p_context_history_messages integer,
  p_context_dossier_entries integer, p_context_credential_policy text, p_context_sender_identity text,
  p_context_human_in_command boolean, p_model_id text, p_input_tokens integer, p_output_tokens integer,
  p_cost_usd numeric, p_latency_ms integer, p_gateway_error text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_turns;
begin
  if p_state is null or p_state not in ('available', 'no_suggestion', 'generation_failed') then
    return jsonb_build_object('result', 'invalid', 'reason', 'state');
  end if;
  if p_state = 'available' and (p_text is null or length(p_text) < 1 or length(p_text) > 4000) then
    return jsonb_build_object('result', 'invalid', 'reason', 'text');
  end if;
  select * into r from public.guest_ai_turns where id = p_suggestion_id for update;
  if not found then return jsonb_build_object('result', 'missing'); end if;
  if r.state <> 'generating' or r.generation_attempts <> coalesce(p_attempt, -1) then
    return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'stale');
  end if;
  update public.guest_ai_turns set
    updated_at = now(), state = p_state,
    suggested_text = case when p_state = 'available' then p_text else null end,
    internal_question = p_internal_question,
    intents = coalesce(p_intents, '{}'),
    strategy = p_strategy,
    handoff_needed = coalesce(p_handoff_needed, false),
    handoff_urgency = p_handoff_urgency,
    outcome_kind = p_outcome_kind,
    outcome_code = p_outcome_code,
    warnings = coalesce(p_warnings, '{}'),
    context_stay_phase = p_context_stay_phase,
    context_reservation_linked = p_context_reservation_linked,
    context_history_messages = p_context_history_messages,
    context_dossier_entries = p_context_dossier_entries,
    context_credential_policy = p_context_credential_policy,
    context_sender_identity = p_context_sender_identity,
    context_human_in_command = p_context_human_in_command,
    model_id = p_model_id,
    gateway_input_tokens = p_input_tokens,
    gateway_output_tokens = p_output_tokens,
    gateway_cost_usd = coalesce(p_cost_usd, 0),
    gateway_latency_ms = p_latency_ms,
    gateway_error = p_gateway_error,
    generation_finished_at = now()
  where id = r.id returning * into r;
  return public.guest_ai_turn_summary(r) || jsonb_build_object('result', 'stored');
end $$;

create or replace function public.guest_ai_purge_turns()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare n integer;
begin
  delete from public.guest_ai_turns where expires_at <= now();
  get diagnostics n = row_count;
  return jsonb_build_object('result', 'purged', 'deleted', n);
end $$;

-- Varredura pós-pausa: libera a resposta não enviada de uma mensagem que chegou durante a pausa da equipe.
create or replace function public.guest_ai_release_unsent_turn(p_conversation_id uuid, p_trigger_message_id uuid, p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare n integer;
begin
  if p_conversation_id is null or p_trigger_message_id is null or p_before is null then return 0; end if;
  delete from public.guest_ai_turns s
   where s.conversation_id = p_conversation_id and s.trigger_message_id = p_trigger_message_id
     and s.created_at < p_before and s.state in ('available', 'superseded', 'no_suggestion', 'generation_failed');
  get diagnostics n = row_count;
  return n;
end $$;

-- Rastro de cada geração (tempo, tentativas, desfecho e, se barrada, a resposta e os bloqueios).
create or replace function public.guest_ai_record_trace(p_trace jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_trace is null or jsonb_typeof(p_trace) <> 'object' then return; end if;
  insert into public.guest_ai_generation_traces
    (suggestion_id, autonomous, total_ms, attempts, retry_reason, final_kind, final_code, failed_stage, remaining_ms, tool_rounds, blocked_reply, blocked_detail)
  values (
    (p_trace->>'suggestion_id')::uuid,
    coalesce((p_trace->>'autonomous')::boolean, false),
    (p_trace->>'total_ms')::integer,
    (p_trace->>'attempts')::smallint,
    nullif(p_trace->>'retry_reason', ''),
    nullif(p_trace->>'final_kind', ''),
    nullif(p_trace->>'final_code', ''),
    nullif(p_trace->>'failed_stage', ''),
    (p_trace->>'remaining_ms')::integer,
    (p_trace->>'tool_rounds')::smallint,
    left(nullif(p_trace->>'blocked_reply', ''), 2000),
    left(nullif(p_trace->>'blocked_detail', ''), 500)
  );
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'guest_ai_claim_turn(uuid, uuid, uuid, uuid, text, numeric, numeric)',
    'guest_ai_turn_state(uuid)',
    'guest_ai_store_turn(uuid, integer, text, text, text, text[], text, boolean, text, text, text, text[], text, boolean, integer, integer, text, text, boolean, text, integer, integer, numeric, integer, text)',
    'guest_ai_purge_turns()',
    'guest_ai_release_unsent_turn(uuid, uuid, timestamptz)',
    'guest_ai_record_trace(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Gerações presas: `generating` há mais de 90 s viram falha por tempo; rastros com mais de 30 dias saem.
do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname = 'ia-geracoes-presas-5min';
end $$;
select cron.schedule(
  'ia-geracoes-presas-5min',
  '*/5 * * * *',
  $cron$
  update public.guest_ai_turns
     set updated_at = now(), state = 'generation_failed', outcome_kind = 'technical_error',
         outcome_code = 'generation_timeout', generation_finished_at = now()
   where state = 'generating' and generation_started_at < now() - interval '90 seconds';
  delete from public.guest_ai_generation_traces where created_at < now() - interval '30 days';
  $cron$
);
