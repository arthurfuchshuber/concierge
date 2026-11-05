-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · VALIDAÇÃO PÓS-APLICAÇÃO (somente leitura).
-- Confere estrutura, RLS, ACL (tabelas, sequências, funções), estado INERTE (escopo `none`, nenhum imóvel
-- ativo, nenhum interruptor, nenhum cron) e a impressão digital das definições.
-- Critério: TODAS as linhas com ok = true. Qualquer false ⇒ rollback (03-rollback-*.sql).
with
rel as (
  select c.oid, c.relname, c.relkind, c.relrowsecurity, c.relacl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'guest\_ai\_%'),
tbl as (select * from rel where relkind = 'r'),
seq as (select * from rel where relkind = 'S'),
fn as (
  select p.oid, p.proname::text as proname, p.prosecdef, array_to_string(p.proconfig, ',') cfg, p.prosrc,
         has_function_privilege('service_role', p.oid, 'execute') sr,
         has_function_privilege('anon', p.oid, 'execute') anon,
         has_function_privilege('authenticated', p.oid, 'execute') auth,
         pg_get_userbyid(p.proowner) owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%' or p.proname like '%\_conversation\_lease')),
worker_rpcs(f) as (values ('claim_conversation_lease'), ('transition_conversation_lease'), ('shadow_get_control'),
  ('shadow_trip'), ('shadow_reserve_budget'), ('shadow_evaluate_breakers'), ('shadow_record_execution'), ('shadow_acquire_tick'),
  ('shadow_release_tick'), ('shadow_claim_execution'), ('shadow_finalize_execution'), ('shadow_reconcile'),
  ('shadow_property_status'), ('shadow_list_candidates')),
checks(check_name, expected, found) as (
  select 'tables', '12', (select count(*)::text from tbl)
  union all select 'tables_rls_on', '12', (select count(*)::text from tbl where relrowsecurity)
  union all select 'no_manifest_table', 'true', (to_regclass('public.guest_ai_shadow_manifest') is null)::text
  union all select 'tables_policies', '0', (select count(*)::text from pg_policy p join tbl on tbl.oid = p.polrelid)
  union all select 'sequences', '3', (select count(*)::text from seq)
  union all select 'functions', '35', (select count(*)::text from fn)
  union all select 'functions_security_definer', '35', (select count(*)::text from fn where prosecdef)
  union all select 'functions_fixed_search_path', '35', (select count(*)::text from fn where cfg = 'search_path=pg_catalog, pg_temp')
  union all select 'functions_owner_executor', '35', (select count(*)::text from fn where owner = current_user)
  union all select 'service_role_execute_exactly_worker_rpcs', 'true',
    ((select coalesce(array_agg(proname::text order by proname::text), '{}') from fn where sr) = (select array_agg(f::text order by f::text) from worker_rpcs))::text
  union all select 'clients_execute_none', '0', (select count(*)::text from fn where anon or auth)
  union all select 'table_privileges_clients', '0', (select count(*)::text from tbl, unnest(array['anon', 'authenticated', 'sandbox_exec']) r(role),
      unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p(priv)
     where exists (select 1 from pg_roles where rolname = r.role) and has_table_privilege(r.role, tbl.oid, p.priv))
  union all select 'table_privileges_service_role_only_select_on_lease', 'guest_ai_conversation_leases:SELECT',
    (select coalesce(string_agg(tbl.relname || ':' || p.priv, ',' order by tbl.relname, p.priv), '') from tbl,
      unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p(priv)
     where has_table_privilege('service_role', tbl.oid, p.priv))
  union all select 'sequence_privileges_any_client', '0', (select count(*)::text from seq, unnest(array['anon', 'authenticated', 'service_role', 'sandbox_exec']) r(role),
      unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv)
     where exists (select 1 from pg_roles where rolname = r.role) and has_sequence_privilege(r.role, seq.oid, p.priv))
  union all select 'no_fk_to_properties', '0', (select count(*)::text from pg_constraint k join tbl on tbl.oid = k.conrelid
     where k.contype = 'f' and k.confrelid = 'public.properties'::regclass)
  union all select 'fks_exact_lease_cascade_and_internal_budget', 'guest_ai_conversation_leases>property_chat_conversations:c,guest_ai_shadow_budget_reservations>guest_ai_shadow_budget_days:a',
    (select coalesce(string_agg(tbl.relname::text || '>' || k.confrelid::regclass::text || ':' || k.confdeltype::text, ',' order by tbl.relname::text), '') from pg_constraint k join tbl on tbl.oid = k.conrelid where k.contype = 'f')
  union all select 'no_free_text_column', '0', (select count(*)::text from information_schema.columns c
     where c.table_schema = 'public' and c.table_name like 'guest\_ai\_%' and c.data_type in ('text', 'character varying', 'json', 'jsonb')
       and not exists (select 1 from pg_constraint k where k.conrelid = ('public.' || c.table_name)::regclass and k.contype = 'c'
                        and pg_get_constraintdef(k.oid) ~ ('\m' || c.column_name || '\M')))
  -- estado inicial: nada ativo, nada habilitado
  union all select 'initial_state_disabled', 'disabled', (select state from public.guest_ai_shadow_control where id = 1)
  union all select 'initial_daily_ceiling', '1.00000000', (select daily_cost_limit_usd::text from public.guest_ai_shadow_control where id = 1)
  -- E4 global: escopo FECHADO e nenhum imóvel ativo (a porta recusa TODO imóvel existente)
  union all select 'initial_scope_none', 'none:0', (select property_scope || ':' || scope_version from public.guest_ai_shadow_control where id = 1)
  union all select 'initial_effective_active_properties', '0',
    (select count(*)::text from public.properties p where public.guest_ai_shadow_property_gate(p.owner_id, p.id) is null)
  union all select 'initial_no_switches', '0:0:0', (select (select count(*) from public.guest_ai_shadow_tenant_switch)::text || ':' ||
    (select count(*) from public.guest_ai_shadow_property_switch)::text || ':' || (select count(*) from public.guest_ai_shadow_switch_log)::text)
  union all select 'initial_no_tick_lock', 'true', (select (tick_owner_token is null)::text from public.guest_ai_shadow_control where id = 1)
  union all select 'initial_no_executions', '0', (select count(*)::text from public.guest_ai_shadow_executions)
  union all select 'initial_no_inflight', '0', (select count(*)::text from public.guest_ai_shadow_inflight)
  -- tetos homologados presentes como CHECK
  union all select 'ceiling_turn_cost_check', 'true', exists (select 1 from pg_constraint where conname = 'gasc_turn_cost_ck' and pg_get_constraintdef(oid) like '%0.15%')::text
  union all select 'ceiling_per_tick_check', 'true', exists (select 1 from pg_constraint where conname = 'gasc_per_tick_ck' and pg_get_constraintdef(oid) like '%3%')::text
  union all select 'ceiling_daily_check', 'true', exists (select 1 from pg_constraint where conname = 'gasc_daily_cost_ck' and pg_get_constraintdef(oid) like '%1.00%')::text
  -- nenhuma função Shadow escreve fora de guest_ai_* (envio ao hóspede impossível pelo banco)
  union all select 'functions_write_only_guest_ai', '0', (select count(*)::text from fn,
      regexp_matches(fn.prosrc, '(insert\s+into|update|delete\s+from)\s+public\.([a-z_]+)', 'gi') m
     where m[2] not like 'guest\_ai\_%')
  -- cron do Shadow NÃO pode existir nesta fase
  union all select 'no_shadow_cron_job', '0',
    -- consulta dinâmica: o schema cron pode não existir (CASE não avalia o ramo não tomado)
    (select case when to_regclass('cron.job') is null then '0'
                 else (xpath('/row/c/text()', query_to_xml('select count(*) as c from cron.job where command ilike ''%shadow-tick%''', false, true, '')))[1]::text end)
)
select check_name, expected, found, found is not distinct from expected as ok from checks
union all
-- impressão digital das definições (mesma da aplicação ensaiada; divergência ⇒ objeto diferente do esperado)
select 'fingerprint_functions', e, f, f = e from (select '89cf8433c5194300ac518ab58ff67792'::text as e,
  md5(string_agg(proname || ':' || md5(prosrc) || ':' || cfg, '|' order by proname)) as f from fn) x
union all
select 'fingerprint_tables', e, f, f = e from (select '0a94ce624d0b91f3555a937e47e8210d'::text as e,
  md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position)) as f
  from information_schema.columns where table_schema = 'public' and table_name like 'guest\_ai\_%') x;
