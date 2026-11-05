-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · Gate A · MATRIZ DE CONFERÊNCIA PÓS-APLICAÇÃO.
-- SOMENTE LEITURA; executar como `postgres` DEPOIS do 02-validate.sql. Uma linha por verificação:
-- item, verificação, esperado, encontrado, resultado (ok | FALHA | comparar).
--  * `ok` exige igualdade EXATA com o esperado; valor nulo ou consulta vazia dá FALHA (nunca aprovação por ausência).
--  * `comparar` = evidência fora deste SQL (fotografia da Capacidade B tirada ANTES; hash de arquivo do código).
--  * As únicas funções chamadas são STABLE e não escrevem (porta, elegibilidade, problema de configuração).
--  * O número de linhas é fixo (41): menos linhas = matriz adulterada.
-- Decisão A1 (M08): cota diária US$ 1,00 no dia UTC; esgotada ⇒ recusa sem desarme; renova à 0h UTC;
-- `over_reservation` e `token_limit_violation` continuam desarmando.
with
ctl as (select * from public.guest_ai_shadow_control where id = 1),
tbl as (select c.oid, c.relname::text as relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'guest\_ai\_%'),
fn as (select p.oid, p.proname::text as proname, p.prosrc, array_to_string(p.proconfig, ',') cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%' or p.proname like '%\_conversation\_lease')),
elig_sql as (  -- regra eligibility.2026-11-05.1 em SQL puro (mesma do 06-inventory.sql)
  select p.id,
    case
      when p.archived_at is not null then 'archived'
      when p.owner_id is null or not exists (select 1 from public.profiles f where f.id = p.owner_id) then 'tenant_unresolved'
      when exists (select 1 from public.property_listing_raw_data l where l.property_id = p.id
                      and (l.owner_id is distinct from p.owner_id
                           or exists (select 1 from public.property_listing_raw_data o where o.property_id <> p.id
                                        and (o.airbnb_listing_id = l.airbnb_listing_id
                                             or (l.channex_property_id is not null and o.channex_property_id = l.channex_property_id)))))
           or exists (select 1 from public.channex_twin_links t where t.property_id = p.id and t.owner_id is distinct from p.owner_id)
        then 'listing_inconsistent'
      when not ((p.published and p.guide_created)
                or exists (select 1 from public.property_listing_raw_data l where l.property_id = p.id and l.not_found_at is null
                             and not (l.sync_paused_at is not null and l.paused_reason = 'account_disconnected'))
                or exists (select 1 from public.host_whatsapp_config w where w.owner_id = p.owner_id and w.status = 'active'))
        then 'no_guest_channel'
      when coalesce(btrim(p.checkin_time), '') = '' or coalesce(btrim(p.checkout_time), '') = '' then 'operational_data_missing'
      else null end as reason_sql,
    public.guest_ai_shadow_eligibility_reason(p.id) as reason_fn,
    public.guest_ai_shadow_property_gate(p.owner_id, p.id) as gate
  from public.properties p),
shadow_cron as (
  select case when to_regclass('cron.job') is null then '0'
    else (xpath('/row/c/text()', query_to_xml(
      'select count(*) as c from cron.job where jobname ilike ''%shadow%'' or jobname ilike ''%guest-ai%'' or command ilike ''%shadow%'' or command ilike ''%guest-ai%''',
      false, true, '')))[1]::text end as n),
rows_guest_ai as (
  select (select count(*) from public.guest_ai_conversation_leases) + (select count(*) from public.guest_ai_shadow_transitions)
       + (select count(*) from public.guest_ai_shadow_executions) + (select count(*) from public.guest_ai_shadow_budget_days)
       + (select count(*) from public.guest_ai_shadow_budget_reservations) + (select count(*) from public.guest_ai_shadow_access_log)
       + (select count(*) from public.guest_ai_shadow_inflight) + (select count(*) from public.guest_ai_shadow_tenant_switch)
       + (select count(*) from public.guest_ai_shadow_property_switch) + (select count(*) from public.guest_ai_shadow_switch_log)
       + (select count(*) from public.guest_ai_shadow_property_eligibility) as n),
m(item, verificacao, esperado, encontrado) as (
  -- M01 Migration: versão correta = definições idênticas às construídas no PostgreSQL 17.6 do ensaio
  select 'M01.1 Migration', 'impressão digital das 35 funções', 'cb6924c65a3b2728178d6724a274842b',
         (select md5(string_agg(proname || ':' || md5(prosrc) || ':' || cfg, '|' order by proname)) from fn)
  union all select 'M01.2 Migration', 'impressão digital das colunas guest_ai_*', '0a94ce624d0b91f3555a937e47e8210d',
         (select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), '|' order by table_name, ordinal_position))
            from information_schema.columns where table_schema = 'public' and table_name like 'guest\_ai\_%')
  union all select 'M01.3 Migration', 'impressão digital das constraints guest_ai_*', 'e19fa0793a32f7fe24b545d4cffe6045',
         (select md5(string_agg(tbl.relname || ':' || k.conname || ':' || pg_get_constraintdef(k.oid), '|' order by tbl.relname, k.conname))
            from pg_constraint k join tbl on tbl.oid = k.conrelid)
  -- M02 Estruturas presentes e íntegras
  union all select 'M02.1 Estruturas', 'as 12 tabelas, pelo nome',
         'guest_ai_conversation_leases,guest_ai_shadow_access_log,guest_ai_shadow_budget_days,guest_ai_shadow_budget_reservations,guest_ai_shadow_control,guest_ai_shadow_executions,guest_ai_shadow_inflight,guest_ai_shadow_property_eligibility,guest_ai_shadow_property_switch,guest_ai_shadow_switch_log,guest_ai_shadow_tenant_switch,guest_ai_shadow_transitions',
         (select string_agg(relname, ',' order by relname) from tbl)
  union all select 'M02.2 Estruturas', 'RLS ligada e 0 políticas nas 12', '12:0',
         (select count(*) filter (where c.relrowsecurity)::text from pg_class c join tbl on tbl.oid = c.oid) || ':' ||
         (select count(*)::text from pg_policy p join tbl on tbl.oid = p.polrelid)
  union all select 'M02.3 Estruturas', 'controle: 1 linha (id=1)', '1', (select count(*)::text from public.guest_ai_shadow_control)
  -- M03 Escopo global
  union all select 'M03.1 Escopo', 'property_scope:scope_version:scope_changed_at', 'none:0:null',
         (select property_scope || ':' || scope_version || ':' || coalesce(scope_changed_at::text, 'null') from ctl)
  union all select 'M03.2 Escopo', 'CHECK do escopo só aceita none/all_eligible e exige evidência para abrir', 'true',
         (exists (select 1 from pg_constraint where conname = 'gasc_scope_ck') and exists (select 1 from pg_constraint where conname = 'gasc_scope_open_ck'))::text
  -- M04 Estado global
  union all select 'M04 Estado', 'state:state_version:transições', 'disabled:1:0',
         (select state || ':' || state_version from ctl) || ':' || (select count(*)::text from public.guest_ai_shadow_transitions)
  -- M05 Cron
  union all select 'M05 Cron', 'jobs do Shadow/Guest AI no pg_cron (qualquer estado; nome ou comando)', '0', (select n from shadow_cron)
  -- M06 Elegibilidade (técnica ≠ autorização)
  union all select 'M06.1 Elegibilidade', 'função do banco = regra em SQL puro, imóvel a imóvel (divergências)', '0',
         (select count(*)::text from elig_sql where reason_sql is distinct from reason_fn)
  union all select 'M06.2 Elegibilidade', 'contagem (referência 05/11: 44 imóveis; 43 elegíveis; 1 no_guest_channel)', 'comparar com o 06-inventory.sql de antes',
         (select count(*) || ' imóveis; ' || count(*) filter (where reason_fn is null) || ' elegíveis; ' ||
                 coalesce(string_agg(distinct reason_fn, ',') filter (where reason_fn is not null), 'nenhum motivo') from elig_sql)
  union all select 'M06.3 Elegibilidade', 'imóveis ATIVOS pela porta (elegível NÃO é autorizado)', '0',
         (select count(*)::text from elig_sql where gate is null)
  union all select 'M06.4 Elegibilidade', 'imóveis cuja porta devolve algo diferente de scope_off', '0',
         (select count(*)::text from elig_sql where gate is distinct from 'scope_off')
  -- M07 Round-robin (definição; o comportamento só é observável com o Shadow em running — ensaio G5)
  union all select 'M07.1 Round-robin', 'rodízio por tenant + ordem de chegada + teto do controle na definição', 'true',
         (select (prosrc like '%row_number() over (partition by e.tenant_id order by e.message_at, e.conversation_id)%'
                  and prosrc like '%order by rn, message_at, conversation_id limit v_limit%'
                  and prosrc like '%least(p_limit, c.max_conversations_per_tick)%')::text
            from fn where proname = 'shadow_list_candidates')
  union all select 'M07.2 Round-robin', 'teto por tick ≤ 3 garantido por CHECK', 'true',
         (exists (select 1 from pg_constraint where conname = 'gasc_per_tick_ck' and pg_get_constraintdef(oid) like '%<= 3%'))::text
  -- M08 Orçamento — decisão A1. M08.1–M08.3 são as três linhas que FALHAVAM antes da correção.
  union all select 'M08.1 Orçamento A1', 'fuso do dia de orçamento: o CHECK aceita SÓ UTC',
         'CHECK (((budget_day_timezone IS NULL) OR (budget_day_timezone = ''UTC''::text)))',
         (select pg_get_constraintdef(oid) from pg_constraint where conname = 'gasc_tz_ck')
  union all select 'M08.2 Orçamento A1', 'reserva acima do teto devolve exceeded e NÃO desarma (shadow_reserve_budget sem chamada de desarme)', 'true',
         (select (prosrc like '%''exceeded'', ''limit'', v_limit%' and prosrc not like '%trip_locked%' and prosrc not like '%budget_exhausted%')::text
            from fn where proname = 'shadow_reserve_budget')
  union all select 'M08.3 Orçamento A1', 'dia esgotado NÃO desarma em nenhuma função (nenhum desarme por cota: motivo inexistente nas funções e nas CHECK)', '0',
         ((select count(*) from fn where prosrc like '%budget\_limit\_reached%')
          + (select count(*) from pg_constraint k join tbl on tbl.oid = k.conrelid where k.contype = 'c' and pg_get_constraintdef(k.oid) like '%budget\_limit\_reached%'))::text
  union all select 'M08.4 Orçamento A1', 'teto diário US$ 1,00 (valor e CHECK ≤ 1,00); nenhum dia aberto; nenhuma reserva', '1.00000000:true:0:0',
         (select daily_cost_limit_usd::text from ctl) || ':' ||
         (exists (select 1 from pg_constraint where conname = 'gasc_daily_cost_ck' and pg_get_constraintdef(oid) like '%<= 1.00%'))::text || ':' ||
         (select count(*)::text from public.guest_ai_shadow_budget_days) || ':' || (select count(*)::text from public.guest_ai_shadow_budget_reservations)
  union all select 'M08.5 Orçamento A1', 'única função que desarma para budget_exhausted', 'shadow_finalize_execution',
         (select string_agg(proname, ',' order by proname) from fn where prosrc ~ 'trip_locked\(c, ''budget_exhausted''')
  union all select 'M08.6 Orçamento A1', 'over_reservation continua desarmando (budget_exhausted / token_limit_violation)', 'true',
         (select (prosrc like '%(v_set->>''over_reservation'')::boolean then%perform public.guest_ai_shadow_trip_locked(c, ''budget_exhausted'', ''token_limit_violation'')%')::text
            from fn where proname = 'shadow_finalize_execution')
  union all select 'M08.7 Orçamento A1', 'token_limit_violation continua aceito como motivo de desarme (RPC do worker e histórico)', 'true',
         (exists (select 1 from fn where proname = 'shadow_trip' and prosrc like '%''token\_limit\_violation''%')
          and exists (select 1 from pg_constraint where conname = 'gast_reason_ck' and pg_get_constraintdef(oid) like '%token\_limit\_violation%'))::text
  union all select 'M08.8 Orçamento A1', 'dia da reserva calculado no fuso do controle (UTC pelo CHECK), nunca no fuso da sessão', 'true',
         (select (prosrc like '%v_day := (now() at time zone c.budget_day_timezone)::date;%')::text from fn where proname = 'shadow_reserve_budget')
  -- M09 Isolamento entre tenants
  union all select 'M09.1 Tenants', 'porta confere dono = tenant; reivindicação revalida a porta', 'true',
         ((select prosrc like '%v_owner is distinct from p_tenant_id%' from fn where proname = 'guest_ai_shadow_property_gate')
          and (select prosrc like '%guest_ai_shadow_property_gate%' from fn where proname = 'shadow_claim_execution'))::text
  union all select 'M09.2 Tenants', 'interruptores e histórico vazios (tenant:imóvel:histórico)', '0:0:0',
         (select count(*)::text from public.guest_ai_shadow_tenant_switch) || ':' || (select count(*)::text from public.guest_ai_shadow_property_switch) || ':' ||
         (select count(*)::text from public.guest_ai_shadow_switch_log)
  union all select 'M09.3 Tenants', 'nenhuma função guest_ai executável por anon/authenticated', '0',
         (select count(*)::text from fn where has_function_privilege('anon', fn.oid, 'execute') or has_function_privilege('authenticated', fn.oid, 'execute'))
  union all select 'M09.4 Tenants', 'administrativas sem EXECUTE para service_role', '0',
         (select count(*)::text from fn where proname in ('shadow_set_scope', 'shadow_set_tenant_enabled', 'shadow_set_property_enabled', 'shadow_refresh_eligibility',
            'shadow_emergency_stop', 'shadow_admin_reconcile', 'shadow_transition', 'shadow_configure', 'shadow_authorize_retention', 'shadow_report', 'shadow_purge_expired')
            and has_function_privilege('service_role', fn.oid, 'execute'))
  union all select 'M09.5 Tenants', 'service_role executa EXATAMENTE as 14 RPCs do worker', '14',
         (select count(*)::text from fn where has_function_privilege('service_role', fn.oid, 'execute'))
  -- M10 PII
  union all select 'M10.1 PII', 'colunas de texto/json sem CHECK que as restrinja (texto livre)', '0',
         (select count(*)::text from information_schema.columns c
           where c.table_schema = 'public' and c.table_name like 'guest\_ai\_%' and c.data_type in ('text', 'character varying', 'json', 'jsonb')
             and not exists (select 1 from pg_constraint k where k.conrelid = ('public.' || c.table_name)::regclass and k.contype = 'c'
                              and pg_get_constraintdef(k.oid) ~ ('\m' || c.column_name || '\M')))
  union all select 'M10.2 PII', 'linhas gravadas em todas as tabelas guest_ai_* exceto o controle', '0', (select n::text from rows_guest_ai)
  union all select 'M10.3 PII', 'candidatas devolvem só ids e superfície (nunca guest_session_id)', 'true',
         (select (prosrc like '%jsonb_build_object(''conversation_id'', conversation_id, ''property_id'', property_id, ''tenant_id'', tenant_id,%'
                  and prosrc not like '%''guest_session_id''%')::text from fn where proname = 'shadow_list_candidates')
  -- M11 Slot (fora do banco)
  union all select 'M11 Slot', 'SHA-256 de src/lib/guest-ai/slot.server.ts', '39228fefe061fa64fa46e19242e2dc21b3078ab668ac5e354a27413f8b212917',
         'NÃO VERIFICÁVEL POR SQL: ver evidência E-SLOT'
  -- M12 Capacidade B somente leitura (banco) + as 18 tabelas operacionais (código)
  union all select 'M12.1 Capacidade B', 'nenhuma função guest_ai escreve fora de guest_ai_*', '0',
         (select count(*)::text from fn, regexp_matches(fn.prosrc, '(insert\s+into|update|delete\s+from|truncate)\s+(table\s+)?public\.([a-z_]+)', 'gi') x
           where x[3] not like 'guest\_ai\_%')
  union all select 'M12.2 Capacidade B', 'nenhum gatilho de tabela do legado chama função guest_ai/shadow', '0',
         (select count(*)::text from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and c.relname not like 'guest\_ai\_%' and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_%'))
  union all select 'M12.3 Capacidade B', 'nenhuma FK de guest_ai_* para properties (excluir/arquivar imóvel segue livre)', '0',
         (select count(*)::text from pg_constraint k join tbl on tbl.oid = k.conrelid where k.contype = 'f' and k.confrelid = 'public.properties'::regclass)
  union all select 'M12.4 Capacidade B', 'fotografia do legado (08-fotografia-capacidade-b.sql) igual à de antes', 'comparar',
         'rodar 08-fotografia-capacidade-b.sql e comparar os 9 valores'
  union all select 'M12.5 Capacidade B', 'fachada somente leitura das 18 tabelas (data/client.server.ts)', 'comparar',
         'NÃO VERIFICÁVEL POR SQL: ver evidência E-FACHADA (SHA-256 + suíte e4g-facade)'
  -- M13 Gate B inativo
  union all select 'M13 Gate B', 'cron:estado:escopo:trava:em andamento:execuções', '0:disabled:none:livre:0:0',
         (select n from shadow_cron) || ':' || (select state from ctl) || ':' || (select property_scope from ctl) || ':' ||
         (select case when tick_owner_token is null then 'livre' else 'PRESA' end from ctl) || ':' ||
         (select count(*)::text from public.guest_ai_shadow_inflight) || ':' || (select count(*)::text from public.guest_ai_shadow_executions)
  -- M14 Gate C bloqueado (sem retenção autorizada e sem modelo, `ready` é recusado pelo banco)
  union all select 'M14.1 Gate C', 'problema de configuração que impede ready/running', 'retention_not_authorized',
         (select public.guest_ai_shadow_config_problem(c) from public.guest_ai_shadow_control c where c.id = 1)
  union all select 'M14.2 Gate C', 'retenção:modelo:fuso configurado', 'null:null:null',
         (select coalesce(retention_scope, 'null') || ':' || coalesce(model_id, 'null') || ':' || coalesce(budget_day_timezone, 'null') from ctl)
)
select item, verificacao, esperado, encontrado,
       case when esperado like 'comparar%' or encontrado like 'NÃO VERIFICÁVEL%' or encontrado like 'rodar %' then 'comparar'
            when encontrado is not distinct from esperado then 'ok' else 'FALHA' end as resultado
  from m
 order by item;
