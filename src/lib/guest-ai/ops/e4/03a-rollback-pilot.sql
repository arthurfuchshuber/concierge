-- ConciergeIA Guest AI · Entrega 4 · ROLLBACK
-- 03a · DESFAZ SÓ O PILOTO (20261105120000_guest_ai_shadow_pilot.sql), voltando ao estado exato da
-- migration Shadow (E3.1). Transacional: rodar inteiro dentro de BEGIN/COMMIT. Não toca em tabela legada.
-- Perde: habilitações por imóvel e seu histórico (só ids; sem dado pessoal).
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
drop function public.shadow_set_property_enabled(uuid, uuid, uuid, boolean, integer, text, text);
-- definições originais (E3.1) das funções redefinidas pelo piloto
create or replace function public.shadow_manifest_add(
  p_actor uuid, p_manifest_version integer, p_tenant_id uuid, p_property_id uuid,
  p_selection_reason text, p_twin_status text, p_history_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  v_owner uuid;
  v_archived timestamptz;
begin
  if p_actor is null or p_manifest_version is null or p_manifest_version <= 0 or p_tenant_id is null or p_property_id is null then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  if p_twin_status is distinct from 'verified' or p_history_status is distinct from 'verified' then
    return jsonb_build_object('result', 'not_verified');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  -- versão ativa (ou anterior) é imutável
  if c.manifest_version is not null and p_manifest_version <= c.manifest_version then
    return jsonb_build_object('result', 'version_immutable');
  end if;
  select owner_id, archived_at into v_owner, v_archived from public.properties where id = p_property_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if v_owner is null or v_owner <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  if v_archived is not null then return jsonb_build_object('result', 'archived'); end if;
  begin
    insert into public.guest_ai_shadow_manifest (manifest_version, tenant_id, property_id, selection_reason, twin_status, history_status, authorized_by)
    values (p_manifest_version, p_tenant_id, p_property_id, p_selection_reason, p_twin_status, p_history_status, p_actor);
  exception
    when unique_violation then return jsonb_build_object('result', 'duplicate');
    when check_violation then return jsonb_build_object('result', 'invalid_argument');
  end;
  return jsonb_build_object('result', 'applied');
end;
$function$;

create or replace function public.shadow_get_manifest()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare v integer;
begin
  select manifest_version into v from public.guest_ai_shadow_control where id = 1;
  if v is null then return jsonb_build_object('result', 'ok', 'manifest_version', null, 'entries', '[]'::jsonb); end if;
  return jsonb_build_object('result', 'ok', 'manifest_version', v, 'entries', coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', m.tenant_id, 'property_id', m.property_id, 'selection_reason', m.selection_reason,
                                        'twin_status', m.twin_status, 'history_status', m.history_status) order by m.property_id)
      from public.guest_ai_shadow_manifest m where m.manifest_version = v), '[]'::jsonb));
end;
$function$;

create or replace function public.shadow_claim_execution(
  p_tick_token text, p_execution_id uuid, p_conversation_id uuid, p_expected_version integer,
  p_tenant_id uuid, p_property_id uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  f public.guest_ai_shadow_inflight%rowtype;
  v_token text;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' or p_execution_id is null or p_conversation_id is null
     or p_expected_version is null or p_expected_version < 1 or p_tenant_id is null or p_property_id is null
     or p_channel is null or p_channel not in ('airbnb', 'whatsapp', 'web') then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  -- repetição idempotente (resposta perdida depois do commit): devolve a MESMA posse, se ainda vigente
  select * into f from public.guest_ai_shadow_inflight where execution_id = p_execution_id;
  if found then
    select * into r from public.guest_ai_conversation_leases where conversation_id = f.conversation_id;
    if f.status = 'running' and f.conversation_id = p_conversation_id and r.version = f.lease_version and r.state = 'processing' and r.lease_expires_at > now() then
      return jsonb_build_object('result', 'claimed', 'repeated', true, 'version', r.version, 'owner_token', r.owner_token, 'batch_id', r.batch_id,
        'message_ids', to_jsonb(r.message_ids), 'attempts', r.attempts);
    end if;
    return jsonb_build_object('result', 'duplicate');
  end if;
  if c.state <> 'running' then return jsonb_build_object('result', 'state_not_running', 'state', c.state); end if;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at < now() + interval '15 seconds' then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  if not exists (select 1 from public.guest_ai_shadow_manifest m
                  where m.manifest_version = c.manifest_version and m.tenant_id = p_tenant_id and m.property_id = p_property_id) then
    return jsonb_build_object('result', 'not_in_manifest');
  end if;
  select * into r from public.guest_ai_conversation_leases where conversation_id = p_conversation_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.version <> p_expected_version then return jsonb_build_object('result', 'stale_version', 'version', r.version, 'state', r.state); end if;
  if r.state <> 'ready' or r.batch_id is null or r.message_ids is null or cardinality(r.message_ids) = 0 then
    return jsonb_build_object('result', 'not_claimable', 'version', r.version, 'state', r.state);
  end if;
  if r.attempts >= 3 then return jsonb_build_object('result', 'attempts_exhausted', 'version', r.version, 'state', r.state); end if;
  if exists (select 1 from public.guest_ai_shadow_inflight where conversation_id = p_conversation_id and status = 'running') then
    return jsonb_build_object('result', 'conflict', 'version', r.version, 'state', r.state);
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.guest_ai_conversation_leases
     set state = 'processing', owner_token = v_token, lease_expires_at = now() + interval '30 seconds',
         attempts = r.attempts + 1, version = r.version + 1, updated_at = now()
   where conversation_id = p_conversation_id
   returning * into r;
  insert into public.guest_ai_shadow_inflight (execution_id, conversation_id, tenant_id, property_id, channel, batch_id, lease_version)
  values (p_execution_id, p_conversation_id, p_tenant_id, p_property_id, p_channel, r.batch_id, r.version);
  return jsonb_build_object('result', 'claimed', 'version', r.version, 'owner_token', r.owner_token, 'batch_id', r.batch_id,
    'message_ids', to_jsonb(r.message_ids), 'attempts', r.attempts);
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
    if (v_set->>'day_exhausted')::boolean then
      perform public.guest_ai_shadow_trip_locked(c, 'budget_exhausted', 'budget_limit_reached');
      select * into c from public.guest_ai_shadow_control where id = 1;
    end if;
    v_last := 'technical_failure';
  end loop;
  if v_n > 0 then
    return jsonb_build_object('result', 'ok', 'reconciled', v_n) || public.guest_ai_shadow_breakers_locked(c, v_last);
  end if;
  return jsonb_build_object('result', 'ok', 'reconciled', 0);
end;
$function$;

drop function public.guest_ai_shadow_reconcile_core(public.guest_ai_shadow_control);
drop function public.guest_ai_shadow_property_active(uuid, uuid);
drop table public.guest_ai_shadow_property_switch_log;
drop table public.guest_ai_shadow_property_switch;
-- privilégios originais (E3.1): administrativas voltam a service_role; as demais como estavam
do $$
declare f text;
begin
  foreach f in array array[
    'public.shadow_manifest_add(uuid, integer, uuid, uuid, text, text, text)',
    'public.shadow_configure(integer, uuid, text, text, integer, integer, integer, numeric, numeric, bigint, integer, integer, integer, text, integer, integer, integer, integer)',
    'public.shadow_authorize_retention(integer, uuid, text, text)',
    'public.shadow_transition(integer, text, uuid, text, text)',
    'public.shadow_report(uuid, text, uuid, timestamptz, timestamptz)',
    'public.shadow_purge_expired()',
    'public.shadow_get_manifest()',
    'public.shadow_claim_execution(text, uuid, uuid, integer, uuid, uuid, text)',
    'public.shadow_reconcile(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
