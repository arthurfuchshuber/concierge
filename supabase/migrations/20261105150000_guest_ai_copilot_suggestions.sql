-- ConciergeIA Guest AI · MODO COPILOTO (diretriz definitiva de 05/11/2026) — sugestões de resposta
-- geradas pela IA e APROVADAS por um atendente humano antes de qualquer envio.
-- Migration LOCAL; NÃO aplicar em produção sem autorização específica (homologação pendente).
--
-- Princípios:
--  * A IA NUNCA envia. Esta tabela guarda SUGESTÕES; o envio só acontece pela rotina humana já existente
--    (`sendHandoffMessage` / `sendWhatsappFromConversation`), acionada por um usuário autenticado.
--  * Escrita SÓ por RPC (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`):
--      - geração (reivindicar, gravar resultado): EXECUTE só para service_role (servidor da aplicação);
--      - ações do atendente (editar, descartar, reivindicar/encerrar/reconciliar envio): EXECUTE só para
--        authenticated — a AUTORIA vem de `auth.uid()` (sessão), nunca de um id enviado pelo frontend.
--  * Leitura: SELECT para authenticated sob RLS do imóvel (`public.user_can_access_property`) e só dentro
--    da retenção aprovada (14 dias). Nenhum hóspede, anon ou outro tenant lê nada.
--  * Idempotência: UMA sugestão por (conversa, mensagem do hóspede que a disparou). Envio com estado e
--    token: available/edited/send_failed → sending → sent | send_failed; resultado ambíguo NUNCA dispara
--    segundo envio automático (`copilot_reconcile_send` verifica a mensagem gravada antes de liberar).
--  * Vocabulário fechado em toda coluna que não seja o texto da sugestão (teto de 4000 caracteres, igual ao
--    envio humano) e a pergunta interna à equipe (teto de 1000). Nenhum prompt, histórico ou contexto bruto.
--  * Controle de custo: teto diário (US$ 1,00, o mesmo aprovado para o Shadow) conferido na reivindicação,
--    contando as gerações em curso pelo pior caso por turno (US$ 0,15). Atingido ⇒ a sugestão nasce
--    `generation_failed/budget_daily_exceeded` e NADA é chamado.
--  * Nenhuma FK para `properties` (não bloqueia a exclusão de imóveis); FK para a conversa com CASCADE.
--  * Retenção: expurgo oportunista a cada reivindicação (sem cron novo) + filtro na leitura.

-- ───────────────────────── Guarda de reexecução e pré-requisitos ─────────────────────────
do $$
begin
  if to_regclass('public.guest_ai_copilot_suggestions') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname like 'copilot\_%') then
    raise exception 'guest_ai_copilot: objetos já existem; migration não reaplicada' using errcode = 'P0001';
  end if;
  if to_regclass('public.property_chat_conversations') is null
     or to_regclass('public.property_chat_messages') is null
     or to_regclass('public.properties') is null then
    raise exception 'guest_ai_copilot: pré-requisito ausente (conversas, mensagens ou imóveis)' using errcode = 'P0001';
  end if;
  if to_regprocedure('public.user_can_access_property(uuid, uuid)') is null then
    raise exception 'guest_ai_copilot: função public.user_can_access_property(uuid, uuid) ausente' using errcode = 'P0001';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'guest_ai_copilot: função auth.uid() ausente' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── Tabela ─────────────────────────
create table public.guest_ai_copilot_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null references public.property_chat_conversations(id) on delete cascade,
  trigger_message_id uuid not null,
  surface text not null check (surface in ('guide_chat', 'whatsapp', 'airbnb')),
  state text not null default 'generating'
    check (state in ('generating', 'available', 'edited', 'sending', 'sent', 'send_failed', 'discarded',
                     'no_suggestion', 'generation_failed', 'superseded')),
  -- texto da sugestão (o ÚNICO texto livre vindo do modelo) e a versão editada pelo atendente
  suggested_text text check (suggested_text is null or length(suggested_text) between 1 and 4000),
  edited_text text check (edited_text is null or length(edited_text) between 1 and 4000),
  -- pergunta interna da IA à equipe (decisão `human_action`); nunca vai ao hóspede
  internal_question text check (internal_question is null or length(internal_question) between 1 and 1000),
  -- classificação (vocabulários do TypeScript: INTENT_CATEGORIES, STRATEGIES, HANDOFF_URGENCIES)
  intents text[] not null default '{}'
    check (intents <@ array['acknowledgment', 'informational_query', 'operational_request', 'problem_report', 'emergency',
                           'formal_change_request', 'arrival_confirmation', 'departure_confirmation', 'other']::text[]),
  strategy text check (strategy is null or strategy in ('answer', 'clarify', 'guide', 'suggest_alternatives', 'handoff', 'answer_and_handoff', 'silence')),
  handoff_needed boolean not null default false,
  handoff_urgency text check (handoff_urgency is null or handoff_urgency in ('low', 'normal', 'high')),
  outcome_kind text check (outcome_kind is null or outcome_kind in ('reply', 'silence', 'human_action', 'paused', 'urgent_internal_alert', 'refused', 'technical_error', 'blocked')),
  outcome_code text check (outcome_code is null or outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  warnings text[] not null default '{}'
    check (warnings <@ array['unknown_facts', 'source_conflicts', 'credential_request_denied', 'unauthorized_commitment', 'handoff_recommended',
                            'emergency', 'sender_identity_unresolved', 'human_in_command', 'reservation_not_linked', 'dossier_unavailable',
                            'history_unavailable', 'formal_change_request']::text[]),
  -- contexto usado (só enums, contadores e booleanos — nenhum texto)
  context_stay_phase text check (context_stay_phase is null or context_stay_phase in ('inquiry', 'pre_stay', 'in_stay', 'post_checkout', 'cancelled', 'no_show', 'unknown')),
  context_reservation_linked boolean,
  context_history_messages integer check (context_history_messages is null or context_history_messages >= 0),
  context_dossier_entries integer check (context_dossier_entries is null or context_dossier_entries >= 0),
  context_credential_policy text check (context_credential_policy is null or context_credential_policy in ('allow', 'deny')),
  context_sender_identity text check (context_sender_identity is null or context_sender_identity in ('resolved', 'unavailable', 'ambiguous', 'invalid', 'not_applicable', 'not_evaluated')),
  context_human_in_command boolean,
  -- Gateway (telemetria mínima para custo e diagnóstico; nenhum texto)
  model_id text check (model_id is null or model_id ~ '^[a-z0-9][a-z0-9./_-]{0,63}$'),
  gateway_input_tokens integer check (gateway_input_tokens is null or gateway_input_tokens >= 0),
  gateway_output_tokens integer check (gateway_output_tokens is null or gateway_output_tokens >= 0),
  gateway_cost_usd numeric(14, 8) not null default 0 check (gateway_cost_usd >= 0),
  gateway_latency_ms integer check (gateway_latency_ms is null or gateway_latency_ms >= 0),
  gateway_error text check (gateway_error is null or gateway_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  generation_attempts integer not null default 1 check (generation_attempts between 1 and 10),
  generation_started_at timestamptz not null default now(),
  generation_finished_at timestamptz,
  -- edição / descarte (autoria = auth.uid())
  edited_at timestamptz,
  edited_by uuid,
  discarded_at timestamptz,
  discarded_by uuid,
  -- envio (reivindicação com token; autoria = auth.uid())
  send_token uuid,
  send_claimed_at timestamptz,
  send_claimed_by uuid,
  send_attempts integer not null default 0 check (send_attempts >= 0),
  sent_at timestamptz,
  sent_by uuid,
  sent_message_id uuid,
  sent_channel text check (sent_channel is null or sent_channel in ('web', 'whatsapp', 'airbnb')),
  sent_provider_message_id text check (sent_provider_message_id is null or length(sent_provider_message_id) between 1 and 200),
  send_error text check (send_error is null or send_error ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  constraint guest_ai_copilot_one_per_trigger unique (conversation_id, trigger_message_id),
  -- coerência de estado: texto obrigatório quando disponível/editada/enviando/enviada
  constraint guest_ai_copilot_text_when_available check (state not in ('available', 'edited', 'sending', 'sent') or suggested_text is not null),
  constraint guest_ai_copilot_edited_has_text check (edited_text is null or edited_by is not null),
  constraint guest_ai_copilot_sent_fields check (state <> 'sent' or (sent_at is not null and sent_by is not null))
);

create index guest_ai_copilot_suggestions_conv_idx on public.guest_ai_copilot_suggestions (conversation_id, created_at desc);
create index guest_ai_copilot_suggestions_expires_idx on public.guest_ai_copilot_suggestions (expires_at);
create index guest_ai_copilot_suggestions_budget_idx on public.guest_ai_copilot_suggestions (generation_started_at);

create or replace function public.guest_ai_copilot_touch()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger guest_ai_copilot_suggestions_touch before update on public.guest_ai_copilot_suggestions
  for each row execute function public.guest_ai_copilot_touch();

-- ───────────────────────── RLS e privilégios ─────────────────────────
alter table public.guest_ai_copilot_suggestions enable row level security;
revoke all on table public.guest_ai_copilot_suggestions from public, anon, authenticated, service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    revoke all on table public.guest_ai_copilot_suggestions from sandbox_exec;
  end if;
end $$;
grant select on table public.guest_ai_copilot_suggestions to authenticated;
-- Só membros com acesso ao imóvel, só dentro da retenção. Nenhuma política de escrita: toda escrita é por RPC.
create policy "copilot: membros do imóvel leem sugestões vigentes" on public.guest_ai_copilot_suggestions
  for select to authenticated
  using (expires_at > now() and public.user_can_access_property(auth.uid(), property_id));

-- Realtime (o cartão da UI atualiza sem polling agressivo). Guardado: só se a publicação existir e não for FOR ALL TABLES.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    alter publication supabase_realtime add table public.guest_ai_copilot_suggestions;
  end if;
end $$;

-- ───────────────────────── Resumo devolvido pelas RPCs ─────────────────────────
create or replace function public.guest_ai_copilot_summary(r public.guest_ai_copilot_suggestions)
returns jsonb
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select jsonb_build_object(
    'suggestion_id', r.id, 'state', r.state, 'conversation_id', r.conversation_id, 'property_id', r.property_id,
    'tenant_id', r.tenant_id, 'surface', r.surface, 'trigger_message_id', r.trigger_message_id,
    'text', coalesce(r.edited_text, r.suggested_text), 'generation_attempts', r.generation_attempts,
    'send_attempts', r.send_attempts, 'send_claimed_at', r.send_claimed_at, 'sent_message_id', r.sent_message_id);
$$;

-- ───────────────────────── Geração (service_role) ─────────────────────────

-- Reivindica a geração de UMA sugestão para (conversa, mensagem do hóspede). Idempotente.
-- Resultado: claimed | exists | invalid | daily_budget_exceeded. Sugestões anteriores ainda vivas da mesma
-- conversa ficam `superseded` (contexto desatualizado); uma geração travada (> 90 s) é reivindicada de novo.
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
     or p_daily_cost_limit_usd is null or p_daily_cost_limit_usd <= 0 or p_daily_cost_limit_usd > 1.00
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
         set generation_started_at = now(), generation_attempts = generation_attempts + 1
       where id = r.id returning * into r;
      return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', true);
    end if;
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'exists');
  end if;

  -- a mensagem nova torna obsoletas as sugestões ainda vivas da conversa
  update public.guest_ai_copilot_suggestions
     set state = 'superseded'
   where conversation_id = p_conversation_id and state in ('generating', 'available', 'edited', 'no_suggestion', 'generation_failed');

  -- teto diário (dia em UTC), contando gerações em curso pelo pior caso
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

  insert into public.guest_ai_copilot_suggestions (tenant_id, property_id, conversation_id, trigger_message_id, surface)
  values (p_tenant_id, p_property_id, p_conversation_id, p_trigger_message_id, p_surface)
  returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'reclaimed', false);
end $$;

-- Estado atual de uma geração (conferido pelo servidor IMEDIATAMENTE antes de chamar o Gateway).
create or replace function public.copilot_generation_state(p_suggestion_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object('state', s.state, 'generation_attempts', s.generation_attempts) from public.guest_ai_copilot_suggestions s where s.id = p_suggestion_id),
    jsonb_build_object('state', 'missing', 'generation_attempts', 0));
$$;

-- Grava o resultado da geração. Só a tentativa reivindicada e só enquanto `generating` (senão `stale`).
create or replace function public.copilot_store_result(
  p_suggestion_id uuid, p_attempt integer, p_state text, p_text text, p_internal_question text,
  p_intents text[], p_strategy text, p_handoff_needed boolean, p_handoff_urgency text,
  p_outcome_kind text, p_outcome_code text, p_warnings text[],
  p_context_stay_phase text, p_context_reservation_linked boolean, p_context_history_messages integer, p_context_dossier_entries integer,
  p_context_credential_policy text, p_context_sender_identity text, p_context_human_in_command boolean,
  p_model_id text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_latency_ms integer, p_gateway_error text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
begin
  if p_state is null or p_state not in ('available', 'no_suggestion', 'generation_failed') then
    return jsonb_build_object('result', 'invalid', 'reason', 'state');
  end if;
  if p_state = 'available' and (p_text is null or length(p_text) < 1 or length(p_text) > 4000) then
    return jsonb_build_object('result', 'invalid', 'reason', 'text');
  end if;
  select * into r from public.guest_ai_copilot_suggestions where id = p_suggestion_id for update;
  if not found then return jsonb_build_object('result', 'missing'); end if;
  if r.state <> 'generating' or r.generation_attempts <> coalesce(p_attempt, -1) then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'stale');
  end if;
  update public.guest_ai_copilot_suggestions set
    state = p_state,
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
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'stored');
end $$;

-- Expurgo da retenção (14 dias). Também roda, limitado, dentro de `copilot_claim_generation`.
create or replace function public.copilot_purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  n integer;
begin
  delete from public.guest_ai_copilot_suggestions where expires_at <= now();
  get diagnostics n = row_count;
  return jsonb_build_object('result', 'purged', 'deleted', n);
end $$;

-- ───────────────────────── Ações do atendente (authenticated; autoria = auth.uid()) ─────────────────────────

-- Carrega e trava a sugestão para o usuário da sessão. Nulo = não existe, expirada ou sem acesso ao imóvel
-- (o chamador devolve `not_found` sem distinguir, para não revelar existência).
create or replace function public.guest_ai_copilot_lock_for_actor(p_suggestion_id uuid, p_actor uuid)
returns public.guest_ai_copilot_suggestions
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
begin
  if p_actor is null or p_suggestion_id is null then return null; end if;
  select * into r from public.guest_ai_copilot_suggestions where id = p_suggestion_id and expires_at > now() for update;
  if not found then return null; end if;
  if not public.user_can_access_property(p_actor, r.property_id) then return null; end if;
  return r;
end $$;

create or replace function public.copilot_edit(p_suggestion_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_text is null or length(btrim(p_text)) < 1 or length(p_text) > 4000 then return jsonb_build_object('result', 'invalid', 'reason', 'text'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, v_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if r.state not in ('available', 'edited', 'send_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set edited_text = case when p_text = suggested_text then null else p_text end,
         edited_by = v_actor, edited_at = now(), state = 'edited'
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'edited');
end $$;

create or replace function public.copilot_discard(p_suggestion_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, v_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if r.state not in ('available', 'edited', 'send_failed', 'no_suggestion', 'generation_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set state = 'discarded', discarded_by = v_actor, discarded_at = now()
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'discarded');
end $$;

-- Reivindica o ENVIO (none → sending). Um clique repetido, uma segunda aba ou uma nova tentativa durante o
-- envio recebem `send_in_progress`; um envio reivindicado há > 2 min sem desfecho recebe `send_unknown` e
-- EXIGE `copilot_reconcile_send` antes de qualquer nova tentativa (nunca reenvia por conta própria).
create or replace function public.copilot_claim_send(p_suggestion_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_actor uuid := auth.uid();
  v_final text;
begin
  if v_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, v_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
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
     set edited_text = case when v_final = suggested_text then null else v_final end,
         edited_by = case when v_final = coalesce(edited_text, suggested_text) then edited_by else v_actor end,
         edited_at = case when v_final = coalesce(edited_text, suggested_text) then edited_at else now() end,
         state = 'sending', send_token = gen_random_uuid(), send_claimed_at = now(), send_claimed_by = v_actor,
         send_attempts = send_attempts + 1, send_error = null
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'send_token', r.send_token);
end $$;

-- Encerra o envio reivindicado (token + mesmo usuário). `sent` exige a mensagem gravada.
create or replace function public.copilot_finish_send(
  p_suggestion_id uuid, p_send_token uuid, p_outcome text, p_message_id uuid, p_provider_message_id text, p_channel text, p_error_code text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_outcome is null or p_outcome not in ('sent', 'failed') then return jsonb_build_object('result', 'invalid', 'reason', 'outcome'); end if;
  if p_channel is not null and p_channel not in ('web', 'whatsapp', 'airbnb') then return jsonb_build_object('result', 'invalid', 'reason', 'channel'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, v_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'sending' then return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state'); end if;
  if r.send_token is null or p_send_token is null or r.send_token <> p_send_token or r.send_claimed_by <> v_actor then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'token_mismatch');
  end if;
  if p_outcome = 'sent' then
    if p_message_id is null then return jsonb_build_object('result', 'invalid', 'reason', 'message_id'); end if;
    update public.guest_ai_copilot_suggestions
       set state = 'sent', sent_at = now(), sent_by = v_actor, sent_message_id = p_message_id,
           sent_provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 200), ''), sent_channel = p_channel,
           send_error = null, send_token = null
     where id = r.id returning * into r;
  else
    update public.guest_ai_copilot_suggestions
       set state = 'send_failed', send_error = coalesce(nullif(p_error_code, ''), 'send_failed'), sent_channel = p_channel, send_token = null
     where id = r.id returning * into r;
  end if;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'finished');
end $$;

-- Reconcilia um envio sem desfecho claro: procura a mensagem gravada pelo MESMO usuário na MESMA conversa
-- depois da reivindicação (nunca por texto: o Airbnb/WhatsApp podem alterar a formatação).
--   encontrada ⇒ `sent` (com o id da mensagem);
--   não encontrada e (tentativa encerrada com erro `p_attempt_finished` ou > 2 min) ⇒ `send_failed`
--     (código `p_error_code`, ou `unknown_result` no prazo vencido); o atendente decide reenviar;
--   não encontrada e ≤ 2 min ⇒ `send_in_progress`.
-- É ESTA função que o servidor chama quando uma tentativa lança erro: só marca falha se nenhuma mensagem foi
-- gravada — um erro depois da gravação (ex.: na pausa da IA) não pode levar a um segundo envio.
create or replace function public.copilot_reconcile_send(p_suggestion_id uuid, p_attempt_finished boolean default false, p_error_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  r public.guest_ai_copilot_suggestions;
  v_actor uuid := auth.uid();
  m record;
begin
  if v_actor is null then return jsonb_build_object('result', 'unauthenticated'); end if;
  if p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$' then return jsonb_build_object('result', 'invalid', 'reason', 'error_code'); end if;
  r := public.guest_ai_copilot_lock_for_actor(p_suggestion_id, v_actor);
  if r.id is null then return jsonb_build_object('result', 'not_found'); end if;
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
       set state = 'sent', sent_at = now(), sent_by = r.send_claimed_by, sent_message_id = m.id,
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
     set state = 'send_failed',
         send_error = case when coalesce(p_attempt_finished, false) then coalesce(p_error_code, 'send_failed') else 'unknown_result' end,
         send_token = null
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', case when coalesce(p_attempt_finished, false) then 'reconciled_failed' else 'reconciled_unknown' end);
end $$;

-- ───────────────────────── Privilégios das funções ─────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.guest_ai_copilot_touch()',
    'public.guest_ai_copilot_summary(public.guest_ai_copilot_suggestions)',
    'public.guest_ai_copilot_lock_for_actor(uuid, uuid)',
    'public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)',
    'public.copilot_generation_state(uuid)',
    'public.copilot_store_result(uuid, integer, text, text, text, text[], text, boolean, text, text, text, text[], text, boolean, integer, integer, text, text, boolean, text, integer, integer, numeric, integer, text)',
    'public.copilot_purge_expired()',
    'public.copilot_edit(uuid, text)',
    'public.copilot_discard(uuid)',
    'public.copilot_claim_send(uuid, text)',
    'public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text)',
    'public.copilot_reconcile_send(uuid, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
  end loop;
  -- geração: só o servidor da aplicação
  foreach f in array array[
    'public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)',
    'public.copilot_generation_state(uuid)',
    'public.copilot_store_result(uuid, integer, text, text, text, text[], text, boolean, text, text, text, text[], text, boolean, integer, integer, text, text, boolean, text, integer, integer, numeric, integer, text)',
    'public.copilot_purge_expired()'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- ações do atendente: só sessão autenticada (autoria = auth.uid() dentro da função)
  foreach f in array array[
    'public.copilot_edit(uuid, text)',
    'public.copilot_discard(uuid)',
    'public.copilot_claim_send(uuid, text)',
    'public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text)',
    'public.copilot_reconcile_send(uuid, boolean, text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
