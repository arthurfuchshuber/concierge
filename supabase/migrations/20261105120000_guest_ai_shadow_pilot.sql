-- ConciergeIA Guest AI · Gate B3.3 · ENTREGA 4 — preparação do PILOTO do Shadow Mode (5 imóveis).
-- Migration LOCAL: NÃO aplicar em produção sem autorização específica (gate de aplicação da Entrega 4).
-- Depende de `20261104000000_guest_ai_conversation_leases.sql` e `20261104120000_guest_ai_shadow.sql`.
--
--  * Habilitação INDIVIDUAL por imóvel (`guest_ai_shadow_property_switch`), estado inicial DESABILITADO
--    (ausência de linha = desabilitado), histórico imutável (`guest_ai_shadow_property_switch_log`: quem,
--    papel do banco, quando, antes/depois, motivo, evidência). Só imóvel do manifesto ATIVO, do mesmo tenant,
--    existente e não arquivado; no máximo 5 habilitados (teto do piloto) e 5 por versão do manifesto.
--  * O tick só enxerga imóveis habilitados (`shadow_get_manifest`) e a reivindicação recusa imóvel
--    desabilitado (`shadow_claim_execution` ⇒ `property_disabled`) — duas barreiras independentes.
--  * Emergência sem alteração improvisada: `shadow_emergency_stop` (para tudo: estado `paused`, trava do tick
--    liberada; execuções em andamento terminam e liquidam normalmente) e `shadow_admin_reconcile`
--    (encerra execuções abandonadas mesmo com o Shadow parado). Desabilitar um imóvel não exige versão.
--  * Administração SÓ pelo dono das funções (operador no SQL do banco): as RPCs administrativas deixam de
--    ser executáveis por service_role — o servidor da aplicação não habilita imóvel, não configura, não
--    religa e não lê relatório. Nenhum privilégio é ampliado.
--  * Nenhuma tabela operacional é alterada; nenhum dado de imóvel é copiado (só ids).

-- ───────────────────────── Guarda (pré-requisitos e reexecução) ─────────────────────────
do $$
begin
  if to_regclass('public.guest_ai_shadow_control') is null or to_regclass('public.guest_ai_shadow_inflight') is null then
    raise exception 'guest_ai_shadow_pilot: migration Shadow (E3.1) ausente' using errcode = 'P0001';
  end if;
  if to_regclass('public.guest_ai_shadow_property_switch') is not null or to_regclass('public.guest_ai_shadow_property_switch_log') is not null
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('shadow_set_property_enabled', 'shadow_emergency_stop', 'shadow_admin_reconcile', 'guest_ai_shadow_property_active', 'guest_ai_shadow_reconcile_core')) then
    raise exception 'guest_ai_shadow_pilot: objetos já existem; migration não reaplicada (conferir com o script de validação)' using errcode = 'P0001';
  end if;
end $$;

-- ───────────────────────── Habilitação individual ─────────────────────────
create table public.guest_ai_shadow_property_switch (
  property_id  uuid primary key,
  tenant_id    uuid not null,
  enabled      boolean not null default false,
  version      integer not null default 1,
  changed_at   timestamptz not null default now(),
  changed_by   uuid not null,
  reason_code  text not null,
  constraint gasps_version_ck check (version >= 1),
  constraint gasps_reason_ck check (reason_code in ('pilot_enable', 'pilot_disable', 'emergency_disable'))
);

create table public.guest_ai_shadow_property_switch_log (
  id              bigint generated always as identity primary key,
  property_id     uuid not null,
  tenant_id       uuid not null,
  from_enabled    boolean not null,
  to_enabled      boolean not null,
  version         integer not null,
  actor           uuid not null,
  db_role         text not null,
  reason_code     text not null,
  evidence_sha256 text,
  at              timestamptz not null default now(),
  constraint gaspl_role_ck check (db_role ~ '^[a-z_][a-z0-9_]{0,62}$'),
  constraint gaspl_reason_ck check (reason_code in ('pilot_enable', 'pilot_disable', 'emergency_disable')),
  constraint gaspl_evidence_ck check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint gaspl_change_ck check (from_enabled <> to_enabled),
  -- habilitar exige referência da autorização
  constraint gaspl_enable_evidence_ck check (not to_enabled or evidence_sha256 is not null)
);

do $$
declare t text;
begin
  foreach t in array array['guest_ai_shadow_property_switch', 'guest_ai_shadow_property_switch_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on table public.%I from sandbox_exec', t);
    end if;
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'guest\_ai\_shadow\_property\_%' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated, service_role', t);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on sequence public.%I from sandbox_exec', t);
    end if;
  end loop;
end $$;

-- Interna: imóvel habilitado e ainda válido (existe, mesmo tenant, não arquivado).
create or replace function public.guest_ai_shadow_property_active(p_tenant_id uuid, p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $function$
  select exists (
    select 1
      from public.guest_ai_shadow_property_switch s
      join public.properties p on p.id = s.property_id
     where s.property_id = p_property_id and s.tenant_id = p_tenant_id and s.enabled
       and p.owner_id = p_tenant_id and p.archived_at is null);
$function$;

-- ADMIN (só o dono): habilita/desabilita UM imóvel. Habilitar exige CAS de versão (0 na primeira vez),
-- referência da autorização e todas as condições; desabilitar nunca é bloqueado (versão opcional).
create or replace function public.shadow_set_property_enabled(
  p_actor uuid, p_property_id uuid, p_tenant_id uuid, p_enabled boolean, p_expected_version integer,
  p_reason text, p_evidence_sha256 text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  c public.guest_ai_shadow_control%rowtype;
  s public.guest_ai_shadow_property_switch%rowtype;
  v_owner uuid;
  v_archived timestamptz;
  v_found boolean;
  v_version integer;
begin
  if p_actor is null or p_property_id is null or p_tenant_id is null or p_enabled is null
     or p_reason is null or p_reason not in ('pilot_enable', 'pilot_disable', 'emergency_disable')
     or (p_enabled and p_reason <> 'pilot_enable') or (not p_enabled and p_reason = 'pilot_enable')
     or (p_evidence_sha256 is not null and p_evidence_sha256 !~ '^[0-9a-f]{64}$')
     or (p_enabled and (p_evidence_sha256 is null or p_expected_version is null)) then
    return jsonb_build_object('result', 'invalid_argument');
  end if;
  -- serializa com reivindicações, ticks e transições
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  select * into s from public.guest_ai_shadow_property_switch where property_id = p_property_id for update;
  v_found := found;
  if v_found and s.tenant_id <> p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
  v_version := case when v_found then s.version else 0 end;
  if p_expected_version is not null and p_expected_version <> v_version then
    return jsonb_build_object('result', 'stale_version', 'version', v_version);
  end if;
  if (v_found and s.enabled = p_enabled) or (not v_found and not p_enabled) then
    return jsonb_build_object('result', 'noop', 'enabled', p_enabled, 'version', v_version);
  end if;
  if p_enabled then
    if c.manifest_version is null or not exists (select 1 from public.guest_ai_shadow_manifest m
         where m.manifest_version = c.manifest_version and m.property_id = p_property_id and m.tenant_id = p_tenant_id) then
      return jsonb_build_object('result', 'not_in_manifest');
    end if;
    select owner_id, archived_at into v_owner, v_archived from public.properties where id = p_property_id;
    if not found then return jsonb_build_object('result', 'not_found'); end if;
    if v_owner is distinct from p_tenant_id then return jsonb_build_object('result', 'tenant_mismatch'); end if;
    if v_archived is not null then return jsonb_build_object('result', 'archived'); end if;
    if (select count(*) from public.guest_ai_shadow_property_switch where enabled and property_id <> p_property_id) >= 5 then
      return jsonb_build_object('result', 'pilot_cap_reached');
    end if;
  end if;
  insert into public.guest_ai_shadow_property_switch (property_id, tenant_id, enabled, version, changed_at, changed_by, reason_code)
  values (p_property_id, p_tenant_id, p_enabled, v_version + 1, now(), p_actor, p_reason)
  on conflict (property_id) do update
     set enabled = excluded.enabled, version = excluded.version, changed_at = excluded.changed_at,
         changed_by = excluded.changed_by, reason_code = excluded.reason_code;
  insert into public.guest_ai_shadow_property_switch_log (property_id, tenant_id, from_enabled, to_enabled, version, actor, db_role, reason_code, evidence_sha256)
  values (p_property_id, p_tenant_id, coalesce(s.enabled, false), p_enabled, v_version + 1, p_actor, session_user, p_reason, p_evidence_sha256);
  return jsonb_build_object('result', 'applied', 'enabled', p_enabled, 'version', v_version + 1);
end;
$function$;

-- ADMIN (só o dono): PARADA DE EMERGÊNCIA global. ready/running ⇒ paused (transição manual registrada);
-- qualquer estado ⇒ trava do tick liberada. Nenhuma execução em andamento é interrompida pela metade: a
-- finalização atômica continua disponível; reservas e liquidações preservadas. Nunca religa nada.
create or replace function public.shadow_emergency_stop(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  r public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into r from public.guest_ai_shadow_control where id = 1 for update;
  if r.state in ('ready', 'running') then
    update public.guest_ai_shadow_control
       set state = 'paused', state_version = r.state_version + 1, changed_at = now(), changed_by = p_actor, reason_code = 'authorized_pause',
           tick_owner_token = null, tick_expires_at = null
     where id = 1;
    insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code)
    values (r.state, 'paused', r.state_version + 1, p_actor, false, 'authorized_pause');
    return jsonb_build_object('result', 'stopped', 'from', r.state, 'state', 'paused', 'state_version', r.state_version + 1);
  end if;
  update public.guest_ai_shadow_control set tick_owner_token = null, tick_expires_at = null where id = 1;
  return jsonb_build_object('result', 'already_stopped', 'state', r.state, 'state_version', r.state_version);
end;
$function$;

-- ───────────────────────── Redefinições (mesma assinatura) ─────────────────────────
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
  -- E4: teto do piloto — no máximo 5 imóveis por versão do manifesto (lista autorizada fechada)
  if (select count(*) from public.guest_ai_shadow_manifest where manifest_version = p_manifest_version) >= 5 then
    return jsonb_build_object('result', 'pilot_cap_reached');
  end if;
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
      from public.guest_ai_shadow_manifest m
     where m.manifest_version = v
       -- E4: só imóveis HABILITADOS individualmente (e ainda válidos) entram no tick
       and public.guest_ai_shadow_property_active(m.tenant_id, m.property_id)), '[]'::jsonb));
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
  -- E4: imóvel HABILITADO individualmente, ainda existente, do mesmo tenant e não arquivado
  if not public.guest_ai_shadow_property_active(p_tenant_id, p_property_id) then
    return jsonb_build_object('result', 'property_disabled');
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

create or replace function public.guest_ai_shadow_reconcile_core(c public.guest_ai_shadow_control)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  f public.guest_ai_shadow_inflight%rowtype;
  r public.guest_ai_conversation_leases%rowtype;
  v_set jsonb;
  v_ins jsonb;
  v_n integer := 0;
  v_ms bigint;
  v_last text := null;
begin
  -- controle já travado pelo chamador (FOR UPDATE)
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

-- Reconciliação: o corpo vira interno (controle travado pelo chamador) para servir ao tick e ao operador.
create or replace function public.shadow_reconcile(p_tick_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_tick_token is null or p_tick_token !~ '^[0-9a-f]{64}$' then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is distinct from p_tick_token or c.tick_expires_at <= now() then
    return jsonb_build_object('result', 'tick_not_held');
  end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ADMIN (só o dono): reconciliação com o Shadow parado (procedimento de emergência). Recusa se um tick
-- estiver com a trava vigente (o tick já reconcilia); nunca toca execução cujo lease ainda vale.
create or replace function public.shadow_admin_reconcile(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare c public.guest_ai_shadow_control%rowtype;
begin
  if p_actor is null then return jsonb_build_object('result', 'invalid_argument'); end if;
  select * into c from public.guest_ai_shadow_control where id = 1 for update;
  if c.tick_owner_token is not null and c.tick_expires_at > now() then return jsonb_build_object('result', 'tick_busy'); end if;
  return public.guest_ai_shadow_reconcile_core(c);
end;
$function$;

-- ───────────────────────── Privilégios ─────────────────────────
do $$
declare f text;
begin
  -- novas: internas e administrativas SEM EXECUTE para ninguém além do dono
  foreach f in array array[
    'public.guest_ai_shadow_property_active(uuid, uuid)',
    'public.guest_ai_shadow_reconcile_core(public.guest_ai_shadow_control)',
    'public.shadow_set_property_enabled(uuid, uuid, uuid, boolean, integer, text, text)',
    'public.shadow_emergency_stop(uuid)',
    'public.shadow_admin_reconcile(uuid)',
    -- E4: administrativas existentes deixam de ser executáveis pelo servidor da aplicação
    'public.shadow_manifest_add(uuid, integer, uuid, uuid, text, text, text)',
    'public.shadow_configure(integer, uuid, text, text, integer, integer, integer, numeric, numeric, bigint, integer, integer, integer, text, integer, integer, integer, integer)',
    'public.shadow_authorize_retention(integer, uuid, text, text)',
    'public.shadow_transition(integer, text, uuid, text, text)',
    'public.shadow_report(uuid, text, uuid, timestamptz, timestamptz)',
    'public.shadow_purge_expired()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    if exists (select 1 from pg_roles where rolname = 'sandbox_exec') then
      execute format('revoke all on function %s from sandbox_exec', f);
    end if;
  end loop;
  -- redefinidas da lista fechada do worker: continuam só para service_role (reafirmado)
  foreach f in array array[
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
