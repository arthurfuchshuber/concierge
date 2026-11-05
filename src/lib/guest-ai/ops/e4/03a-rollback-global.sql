-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · ROLLBACK
-- 03a · DESFAZ SÓ A MIGRATION GLOBAL (20261105120000_guest_ai_shadow_global.sql), voltando ao estado
-- exato da migration Shadow base — em que a porta de imóvel está FECHADA (todo imóvel ⇒ `scope_off`):
-- sem a migration global, nenhuma reivindicação passa. Transacional: rodar inteiro dentro de BEGIN/COMMIT.
-- Não toca em tabela legada. Perde: escopo, interruptores, histórico dos interruptores e a foto da
-- elegibilidade (só ids e códigos; nenhum dado pessoal) — exportar antes se houver valor de auditoria.
do $$
declare v_cron boolean := false;
begin
  if exists (select 1 from public.guest_ai_shadow_control where state in ('ready', 'running')) then
    raise exception 'rollback interrompido: Shadow ativo (rode shadow_emergency_stop antes)' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.guest_ai_shadow_inflight where status = 'running') then
    raise exception 'rollback interrompido: execução em andamento (aguarde o prazo e rode shadow_admin_reconcile)' using errcode = 'P0001';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where command ilike ''%shadow-tick%'')' into v_cron;
  end if;
  if v_cron then
    raise exception 'rollback interrompido: remova antes o agendamento do Shadow (cron.unschedule)' using errcode = 'P0001';
  end if;
end $$;

drop function public.shadow_admin_reconcile(uuid);
drop function public.shadow_emergency_stop(uuid);
drop function public.shadow_refresh_eligibility(uuid);
drop function public.shadow_set_property_enabled(uuid, uuid, uuid, boolean, integer, text, text);
drop function public.shadow_set_tenant_enabled(uuid, uuid, boolean, integer, text, text);
drop function public.shadow_set_scope(uuid, integer, text, text, text);
drop function public.shadow_list_candidates(text, integer, integer);
drop function public.shadow_property_status(uuid, uuid);
-- definições ORIGINAIS da migration base (porta fechada, leitura do estado e reconciliação)
create or replace function public.guest_ai_shadow_property_gate(p_tenant_id uuid, p_property_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select 'scope_off'::text;
$function$;

create or replace function public.shadow_get_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  select * into c from public.guest_ai_shadow_control where id = 1;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  return jsonb_build_object(
    'result', 'ok', 'state', c.state, 'state_version', c.state_version, 'model_id', c.model_id, 'reasoning_effort', c.reasoning_effort,
    'max_input_tokens', c.max_input_tokens, 'max_output_tokens', c.max_output_tokens, 'max_total_tokens', c.max_total_tokens,
    'max_turn_cost_usd', c.max_turn_cost_usd, 'daily_cost_limit_usd', c.daily_cost_limit_usd, 'max_daily_tokens', c.max_daily_tokens,
    'max_daily_calls', c.max_daily_calls, 'error_window_minutes', c.error_window_minutes, 'error_min_sample', c.error_min_sample,
    'budget_day_timezone', c.budget_day_timezone, 'telemetry_retention_days', c.telemetry_retention_days,
    'tick_interval_seconds', c.tick_interval_seconds, 'max_conversations_per_tick', c.max_conversations_per_tick,
    'retention_scope', c.retention_scope,
    'retention_authorized', c.retention_scope is not null and c.retention_authorized_at is not null,
    -- F-09/F-03: o instante do BANCO; o worker ancora nele todo instante de parede (pausa, coletor, registro)
    'db_now', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
end;
$function$;

create or replace function public.shadow_reconcile(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_set jsonb;
  v_ins jsonb;
  v_n integer := 0;
  v_ms bigint;
  v_last text := null;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  for f in select * from public.guest_ai_shadow_inflight where status = 'running' order by started_at for update loop
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id for update;
    -- worker vivo dentro do prazo do lease: não é órfão
    continue when found and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now();
    if found and r.batch_id = f.batch_id and (
         (r.version = f.lease_version and r.state = 'processing')
         or (r.state in ('expired', 'cancelled', 'failed') and cardinality(coalesce(r.message_ids, '{}')) > 0)) then
      perform public.guest_ai_shadow_seal_lease(r, 'failed');
    end if;
    v_set := public.guest_ai_shadow_settle_locked(c, f.execution_id, 'orphan_worst_case', null, null, null);
    v_ms := least(2147483647, greatest(0, floor(extract(epoch from (now() - f.started_at)) * 1000)))::bigint;
    v_ins := public.guest_ai_shadow_insert_execution(jsonb_build_object(
      'execution_id', f.execution_id, 'tenant_id', f.tenant_id, 'property_id', f.property_id, 'conversation_id', f.conversation_id,
      'batch_id', f.batch_id, 'lease_version', f.lease_version, 'channel', f.channel,
      'chain_version', 'db-reconcile.2026-11-04.1', 'shadow_version', 'db-reconcile.2026-11-04.1', 'composer_version', null,
      'model_id', c.model_id, 'started_at', f.started_at, 'finished_at', now(), 'total_ms', v_ms, 'lease_ms', 0, 'context_ms', 0,
      'gateway_ms', 0, 'validation_ms', 0, 'timing_context', null, 'timing_dossier', null, 'timing_history', null, 'timing_scope_check', null,
      'timing_stay_authorizations', null, 'timing_human_ownership', null, 'timing_human_pause', null, 'timing_sender_identity', null,
      'timing_guard', null, 'timing_compose', null, 'timing_model_output', null, 'timing_parse', null, 'timing_structural_validation', null,
      'timing_semantic_validation', null, 'timing_final_decision', null) || jsonb_build_object(
      -- uso desconhecido: o registro conta o que foi LIQUIDADO (pior caso), nunca menos
      'input_tokens', 0, 'output_tokens', 0, 'reasoning_tokens', 0,
      'total_tokens', coalesce((select settled_tokens from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'usage_source', 'none',
      'cost_usd', coalesce((select settled_cost from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'gateway_calls', coalesce((select settled_calls from public.guest_ai_shadow_budget_reservations where execution_id = f.execution_id), 0),
      'estimated_input_tokens', null, 'candidate_available', false, 'decision', 'technical_failure', 'strategy', null,
      'intents', '[]'::jsonb, 'intent_count', 0, 'commitment_kinds', '[]'::jsonb, 'human_intervention_needed', false, 'handoff_urgency', null,
      'pause_state', 'not_evaluated', 'context_check', 'not_run', 'execution_state', 'failed', 'response_discarded', true, 'timeout', false,
      'token_limit_violation', false, 'concurrency_detected', false, 'gateway_error', null, 'budget_exceeded', null, 'refusal_code', null,
      'technical_code', 'worker_lost', 'block_code', null, 'integrity_code', null));
    if v_ins->>'result' <> 'inserted' then
      raise exception using errcode = 'P0001', message = 'shadow_reconcile_record_rejected';
    end if;
    update public.guest_ai_shadow_inflight set status = 'reconciled', closed_at = now() where execution_id = f.execution_id;
    v_n := v_n + 1;
    -- A1: a liquidação pelo pior caso fica registrada; dia esgotado NÃO desarma
    v_last := 'technical_failure';
  end loop;
  if v_n > 0 then
    return jsonb_build_object('result', 'ok', 'reconciled', v_n) || public.guest_ai_shadow_breakers_locked(c, v_last);
  end if;
  return jsonb_build_object('result', 'ok', 'reconciled', 0);
end;
$function$;

drop function public.guest_ai_shadow_reconcile_core(public.guest_ai_shadow_control);
drop function public.guest_ai_shadow_eligibility_reason(uuid);
drop table public.guest_ai_shadow_property_eligibility;
drop table public.guest_ai_shadow_switch_log;
drop table public.guest_ai_shadow_property_switch;
drop table public.guest_ai_shadow_tenant_switch;
alter table public.guest_ai_shadow_control
  drop constraint gasc_scope_open_ck,
  drop constraint gasc_scope_evidence_ck,
  drop constraint gasc_scope_version_ck,
  drop constraint gasc_scope_ck,
  drop column scope_evidence_sha256,
  drop column scope_changed_by,
  drop column scope_changed_at,
  drop column scope_version,
  drop column property_scope;
-- privilégios: as funções redefinidas mantêm a ACL (create or replace); a porta fechada continua sem EXECUTE
do $$
begin
  if has_function_privilege('service_role', 'public.guest_ai_shadow_property_gate(uuid, uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.shadow_get_control()', 'execute')
     or not has_function_privilege('service_role', 'public.shadow_reconcile(text)', 'execute') then
    raise exception 'rollback: privilégios divergentes do estado base' using errcode = 'P0001';
  end if;
end $$;
