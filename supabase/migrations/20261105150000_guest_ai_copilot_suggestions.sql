-- ConciergeIA Guest AI · MODO COPILOTO — BUNDLE ÚNICO da tabela `guest_ai_copilot_suggestions`.
--
-- ESTRITAMENTE ADITIVO. Cria SÓ: a tabela nova, seus índices e constraints, RLS e UMA política de leitura
-- exclusiva dela, grants mínimos e as 11 funções que a aplicação chama (necessidade comprovada pelo código:
-- `copilot-actions.server.ts`, `copilot-send.server.ts`, `guest-ai/copilot/store.server.ts`). NÃO altera
-- nenhuma tabela, política, trigger, função, publicação ou dado existente. Sem FK para tabelas operacionais
-- (uma FK criaria triggers internos nelas). Sem trigger. Sem publicação realtime (a tela consulta por polling).
-- Não ativa geração, envio, Shadow Mode nem processamento autônomo.
--
-- Um ÚNICO comando (bloco DO) ⇒ uma única transação; qualquer falha desfaz TUDO (fail-closed).
--   1. Preflight de ambiente e permissões (versão, papéis, usuário executor, pré-requisitos com assinatura
--      e SECURITY DEFINER conferidos, colunas lidas pelas funções).
--   2. Estado: ausente ⇒ cria; presente e IDÊNTICO (impressão digital do catálogo) ⇒ não faz nada (idempotente);
--      presente parcial ou divergente ⇒ INTERROMPE com o conflito (nunca ignora divergência).
--   3. Criação.
--   4. Pós-verificação: impressão digital exata, RLS, política, grants por papel, e catálogo operacional
--      IDÊNTICO ao de antes (nenhuma tabela/política/trigger/função/publicação existente mudou).
-- Retenção: 14 dias (expires_at), filtrada na leitura e expurgada a cada geração (`copilot_claim_generation`).
DO $bundle$
DECLARE
  c_expected_fp constant text := '7d44f2b612ae65f3db08db0e171a43ef';
  v_fp text;
  v_ops_before text;
  v_ops_after text;
  v_has_table boolean;
  v_fn_count integer;
  v_missing text;
  f text;
BEGIN
  -- ───────────── 1. PREFLIGHT: ambiente e permissões ─────────────
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'COPILOT_PREFLIGHT: PostgreSQL >= 15 exigido (atual %)', current_setting('server_version');
  end if;
  if current_user in ('anon', 'authenticated', 'service_role', 'sandbox_exec') then
    raise exception 'COPILOT_PREFLIGHT: executor % não pode criar objetos', current_user;
  end if;
  if not has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'COPILOT_PREFLIGHT: % sem CREATE no schema public', current_user;
  end if;
  select string_agg(r, ',') into v_missing from unnest(array['anon', 'authenticated', 'service_role']) r where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then raise exception 'COPILOT_PREFLIGHT: papéis ausentes: %', v_missing; end if;
  if to_regprocedure('auth.uid()') is null or to_regprocedure('gen_random_uuid()') is null then
    raise exception 'COPILOT_PREFLIGHT: auth.uid() ou gen_random_uuid() ausente';
  end if;
  if to_regclass('public.properties') is null or to_regclass('public.property_chat_conversations') is null or to_regclass('public.property_chat_messages') is null then
    raise exception 'COPILOT_PREFLIGHT: tabelas pré-requisito ausentes (properties, property_chat_conversations, property_chat_messages)';
  end if;
  select string_agg(want, ', ') into v_missing from (values
      ('properties', 'id', 'uuid'), ('properties', 'owner_id', 'uuid'),
      ('property_chat_conversations', 'id', 'uuid'), ('property_chat_conversations', 'property_id', 'uuid'),
      ('property_chat_messages', 'id', 'uuid'), ('property_chat_messages', 'conversation_id', 'uuid'),
      ('property_chat_messages', 'sender_user_id', 'uuid'), ('property_chat_messages', 'created_at', 'timestamp with time zone'),
      ('property_chat_messages', 'delivery_status', 'text'), ('property_chat_messages', 'is_internal_note', 'boolean'),
      ('property_chat_messages', 'channel', 'text'), ('property_chat_messages', 'external_id', 'text')
    ) w(tbl, col, typ), lateral (select tbl || '.' || col || ':' || typ as want) x
   where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = w.tbl and c.column_name = w.col and c.data_type = w.typ);
  if v_missing is not null then raise exception 'COPILOT_PREFLIGHT: colunas ausentes ou com tipo diferente: %', v_missing; end if;
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.user_can_access_property(uuid, uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.has_member_permission(uuid, uuid, public.member_permission)') and prosecdef) then
    raise exception 'COPILOT_PREFLIGHT: user_can_access_property/has_member_permission ausentes ou sem SECURITY DEFINER';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'member_permission' and e.enumlabel = 'chat_respond') then
    raise exception 'COPILOT_PREFLIGHT: permissão chat_respond ausente em member_permission';
  end if;

  -- prefixo reservado: nada além da própria tabela e dos índices dela pode existir com esse nome (senão ficaria
  -- fora da verificação do catálogo operacional)
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname like 'guest\_ai\_copilot\_%'
                and c.oid <> coalesce(to_regclass('public.guest_ai_copilot_suggestions'), 0::oid)
                and c.oid not in (select indexrelid from pg_index where indrelid = coalesce(to_regclass('public.guest_ai_copilot_suggestions'), 0::oid))) then
    raise exception 'COPILOT_PREFLIGHT: relação estranha com prefixo guest_ai_copilot_ — nada foi alterado';
  end if;

  -- ───────────── 2. ESTADO: ausente / idêntico / conflito ─────────────
  v_has_table := to_regclass('public.guest_ai_copilot_suggestions') is not null;
  select count(*) into v_fn_count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'copilot\_%' or p.proname like 'guest\_ai\_copilot\_%');
  if v_has_table or v_fn_count > 0 then
    if not v_has_table or v_fn_count <> 11 then
      raise exception 'COPILOT_CONFLITO: aplicação parcial (tabela=%, funções=% de 11) — nada foi alterado; inspecionar antes de qualquer ação', v_has_table, v_fn_count;
    end if;
    execute $fp$select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
      select 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'public.guest_ai_copilot_suggestions'::regclass and a.attnum > 0 and not a.attisdropped
      union all select 'con ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'idx ' || pg_get_indexdef(indexrelid) from pg_index where indrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'rel ' || relrowsecurity || ' ' || relforcerowsecurity || ' ' || coalesce(relacl::text, '') from pg_class where oid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'pol ' || polname || ' ' || polcmd::text || ' ' || polpermissive || ' ' || array_to_string(array(select rolname from pg_roles where oid = any(polroles) order by 1), ',') || ' ' || coalesce(pg_get_expr(polqual, polrelid), '') || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        from pg_policy where polrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'trg ' || tgname from pg_trigger where tgrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'pub ' || pubname from pg_publication_rel pr join pg_publication pb on pb.oid = pr.prpubid where pr.prrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'copilot\_%' or p.proname like 'guest\_ai\_copilot\_%')
    ) s(x)$fp$ into v_fp;
    if v_fp = c_expected_fp then
      raise notice 'COPILOT_JA_APLICADO: estrutura idêntica ao bundle (fp %) — nenhuma alteração', v_fp;
      return;
    end if;
    raise exception 'COPILOT_CONFLITO: estrutura existente diverge do bundle (fp % ≠ %) — nada foi alterado', v_fp, c_expected_fp;
  end if;

  execute $ops$select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
      select 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity || ' ' || coalesce(c.relacl::text, '')
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'con ' || c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'trg ' || c.relname || '.' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
        from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'fn ' || p.oid::regprocedure::text || ' ' || p.prosecdef || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname not like 'copilot\_%' and p.proname not like 'guest\_ai\_copilot\_%'
      union all select 'pub ' || pb.pubname || ' ' || pr.prrelid::regclass::text from pg_publication_rel pr join pg_publication pb on pb.oid = pr.prpubid
    ) s(x)$ops$ into v_ops_before;

  -- ───────────── 3. CRIAÇÃO ─────────────
  execute $q$
create table public.guest_ai_copilot_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  property_id uuid not null,
  conversation_id uuid not null,
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
)
$q$;

  execute $q$
create index guest_ai_copilot_suggestions_conv_idx on public.guest_ai_copilot_suggestions (conversation_id, created_at desc)
$q$;

  execute $q$
create index guest_ai_copilot_suggestions_expires_idx on public.guest_ai_copilot_suggestions (expires_at)
$q$;

  execute $q$
create index guest_ai_copilot_suggestions_budget_idx on public.guest_ai_copilot_suggestions (generation_started_at)
$q$;

  execute $q$
alter table public.guest_ai_copilot_suggestions enable row level security
$q$;

  execute $q$
revoke all on table public.guest_ai_copilot_suggestions from public, anon, authenticated, service_role
$q$;

  execute $q$
grant select on table public.guest_ai_copilot_suggestions to authenticated
$q$;

  execute $q$
create policy "copilot: membros do imóvel leem sugestões vigentes" on public.guest_ai_copilot_suggestions
  for select to authenticated
  using (expires_at > now() and public.user_can_access_property(auth.uid(), property_id))
$q$;

  execute $q$
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
$$
$q$;

  execute $q$
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
end $$
$q$;

  execute $q$
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
$$
$q$;

  execute $q$
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
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'stored');
end $$
$q$;

  execute $q$
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
end $$
$q$;

  execute $q$
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
end $$
$q$;

  execute $q$
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
  if not public.has_member_permission(v_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state not in ('available', 'edited', 'send_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), edited_text = case when p_text = suggested_text then null else p_text end,
         edited_by = v_actor, edited_at = now(), state = 'edited'
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'edited');
end $$
$q$;

  execute $q$
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
  if not public.has_member_permission(v_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state not in ('available', 'edited', 'send_failed', 'no_suggestion', 'generation_failed') then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state');
  end if;
  update public.guest_ai_copilot_suggestions
     set updated_at = now(), state = 'discarded', discarded_by = v_actor, discarded_at = now()
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'discarded');
end $$
$q$;

  execute $q$
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
  if not public.has_member_permission(v_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
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
         edited_by = case when v_final = coalesce(edited_text, suggested_text) then edited_by else v_actor end,
         edited_at = case when v_final = coalesce(edited_text, suggested_text) then edited_at else now() end,
         state = 'sending', send_token = gen_random_uuid(), send_claimed_at = now(), send_claimed_by = v_actor,
         send_attempts = send_attempts + 1, send_error = null
   where id = r.id returning * into r;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'claimed', 'send_token', r.send_token);
end $$
$q$;

  execute $q$
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
  if not public.has_member_permission(v_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
    return jsonb_build_object('result', 'forbidden');
  end if;
  if r.state <> 'sending' then return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'invalid_state'); end if;
  if r.send_token is null or p_send_token is null or r.send_token <> p_send_token or r.send_claimed_by <> v_actor then
    return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'token_mismatch');
  end if;
  if p_outcome = 'sent' then
    if p_message_id is null then return jsonb_build_object('result', 'invalid', 'reason', 'message_id'); end if;
    update public.guest_ai_copilot_suggestions
       set updated_at = now(), state = 'sent', sent_at = now(), sent_by = v_actor, sent_message_id = p_message_id,
           sent_provider_message_id = nullif(left(coalesce(p_provider_message_id, ''), 200), ''), sent_channel = p_channel,
           send_error = null, send_token = null
     where id = r.id returning * into r;
  else
    update public.guest_ai_copilot_suggestions
       set updated_at = now(), state = 'send_failed', send_error = coalesce(nullif(p_error_code, ''), 'send_failed'), sent_channel = p_channel, send_token = null
     where id = r.id returning * into r;
  end if;
  return public.guest_ai_copilot_summary(r) || jsonb_build_object('result', 'finished');
end $$
$q$;

  execute $q$
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
  if not public.has_member_permission(v_actor, (select p.owner_id from public.properties p where p.id = r.property_id), 'chat_respond'::public.member_permission) then
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
end $$
$q$;

  -- privilégios das funções: ninguém por padrão; geração ⇒ service_role; ações do atendente ⇒ authenticated
  foreach f in array array[
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
  if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
    execute 'revoke all on table public.guest_ai_copilot_suggestions from sandbox_exec';
  end if;
  foreach f in array array[
      'public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)',
      'public.copilot_generation_state(uuid)',
      'public.copilot_store_result(uuid, integer, text, text, text, text[], text, boolean, text, text, text, text[], text, boolean, integer, integer, text, text, boolean, text, integer, integer, numeric, integer, text)',
      'public.copilot_purge_expired()'] loop
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
      'public.copilot_edit(uuid, text)',
      'public.copilot_discard(uuid)',
      'public.copilot_claim_send(uuid, text)',
      'public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text)',
      'public.copilot_reconcile_send(uuid, boolean, text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- ───────────── 4. PÓS-VERIFICAÇÃO (qualquer falha desfaz tudo) ─────────────
  execute $fp$select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
      select 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = 'public.guest_ai_copilot_suggestions'::regclass and a.attnum > 0 and not a.attisdropped
      union all select 'con ' || conname || ' ' || contype::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'idx ' || pg_get_indexdef(indexrelid) from pg_index where indrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'rel ' || relrowsecurity || ' ' || relforcerowsecurity || ' ' || coalesce(relacl::text, '') from pg_class where oid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'pol ' || polname || ' ' || polcmd::text || ' ' || polpermissive || ' ' || array_to_string(array(select rolname from pg_roles where oid = any(polroles) order by 1), ',') || ' ' || coalesce(pg_get_expr(polqual, polrelid), '') || ' ' || coalesce(pg_get_expr(polwithcheck, polrelid), '')
        from pg_policy where polrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'trg ' || tgname from pg_trigger where tgrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'pub ' || pubname from pg_publication_rel pr join pg_publication pb on pb.oid = pr.prpubid where pr.prrelid = 'public.guest_ai_copilot_suggestions'::regclass
      union all select 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || p.prosecdef || ' ' || p.provolatile::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '') || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'copilot\_%' or p.proname like 'guest\_ai\_copilot\_%')
    ) s(x)$fp$ into v_fp;
  if v_fp <> c_expected_fp then
    raise exception 'COPILOT_POS: impressão digital % ≠ esperada % — desfeito', v_fp, c_expected_fp;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.guest_ai_copilot_suggestions'::regclass) then
    raise exception 'COPILOT_POS: RLS desligada — desfeito';
  end if;
  if (select count(*) from pg_policy where polrelid = 'public.guest_ai_copilot_suggestions'::regclass) <> 1
     or (select polcmd from pg_policy where polrelid = 'public.guest_ai_copilot_suggestions'::regclass) <> 'r' then
    raise exception 'COPILOT_POS: políticas diferentes de exatamente 1 de leitura — desfeito';
  end if;
  if has_table_privilege('anon', 'public.guest_ai_copilot_suggestions', 'SELECT')
     or has_table_privilege('authenticated', 'public.guest_ai_copilot_suggestions', 'INSERT,UPDATE,DELETE,TRUNCATE')
     or has_table_privilege('service_role', 'public.guest_ai_copilot_suggestions', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     or not has_table_privilege('authenticated', 'public.guest_ai_copilot_suggestions', 'SELECT') then
    raise exception 'COPILOT_POS: privilégios da tabela fora do mínimo — desfeito';
  end if;
  foreach f in array array['public.copilot_claim_generation(uuid, uuid, uuid, uuid, text, numeric, numeric)',
      'public.copilot_generation_state(uuid)',
      'public.copilot_store_result(uuid, integer, text, text, text, text[], text, boolean, text, text, text, text[], text, boolean, integer, integer, text, text, boolean, text, integer, integer, numeric, integer, text)',
      'public.copilot_purge_expired()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') or not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'COPILOT_POS: privilégio incorreto em % — desfeito', f;
    end if;
  end loop;
  foreach f in array array['public.copilot_edit(uuid, text)',
      'public.copilot_discard(uuid)',
      'public.copilot_claim_send(uuid, text)',
      'public.copilot_finish_send(uuid, uuid, text, uuid, text, text, text)',
      'public.copilot_reconcile_send(uuid, boolean, text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'COPILOT_POS: privilégio incorreto em % — desfeito', f;
    end if;
  end loop;
  foreach f in array array['public.guest_ai_copilot_summary(public.guest_ai_copilot_suggestions)', 'public.guest_ai_copilot_lock_for_actor(uuid, uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'COPILOT_POS: função interna % exposta — desfeito', f;
    end if;
  end loop;
  execute $ops$select md5(coalesce(string_agg(x, E'\n' order by x), '')) from (
      select 'rel ' || c.relname || ' ' || c.relkind::text || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity || ' ' || coalesce(c.relacl::text, '')
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'col ' || c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
        from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'con ' || c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
        from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'trg ' || c.relname || '.' || t.tgname || ' ' || t.tgenabled::text || ' ' || t.tgfoid::regprocedure::text
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'pol ' || c.relname || '.' || p.polname || ' ' || p.polcmd::text || ' ' || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
        from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname not like 'guest\_ai\_copilot\_%'
      union all select 'fn ' || p.oid::regprocedure::text || ' ' || p.prosecdef || ' ' || md5(p.prosrc) || ' ' || coalesce(p.proacl::text, '') || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname not like 'copilot\_%' and p.proname not like 'guest\_ai\_copilot\_%'
      union all select 'pub ' || pb.pubname || ' ' || pr.prrelid::regclass::text from pg_publication_rel pr join pg_publication pb on pb.oid = pr.prpubid
    ) s(x)$ops$ into v_ops_after;
  if v_ops_after <> v_ops_before then
    raise exception 'COPILOT_POS: o catálogo operacional mudou (% → %) — desfeito', v_ops_before, v_ops_after;
  end if;
  raise notice 'COPILOT_APLICADO: fp % · catálogo operacional inalterado (%)', v_fp, v_ops_after;
END
$bundle$;
