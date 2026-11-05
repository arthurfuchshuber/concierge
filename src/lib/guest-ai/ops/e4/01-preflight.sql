-- ConciergeIA Guest AI · Entrega 4 · PREFLIGHT (somente leitura). Rodar no banco ALVO antes de aplicar
-- 20261104000000_guest_ai_conversation_leases.sql, 20261104120000_guest_ai_shadow.sql e
-- 20261105120000_guest_ai_shadow_pilot.sql. Cada linha: verificação, esperado, encontrado, ok.
-- Critério de interrupção: QUALQUER linha com ok = false ⇒ NÃO aplicar.
with checks(check_name, expected, found) as (
  select 'postgres_major', '17', split_part(current_setting('server_version'), '.', 1)
  union all select 'executor_role', 'postgres (dono das funções SECURITY DEFINER)', current_user::text
  union all select 'executor_not_superuser_ok', 'qualquer', (select rolsuper::text from pg_roles where rolname = current_user)
  union all select 'executor_can_create_in_public', 'true', has_schema_privilege(current_user, 'public', 'CREATE')::text
  union all select 'timezone_sao_paulo', 'true', exists (select 1 from pg_timezone_names where name = 'America/Sao_Paulo')::text
  union all select 'gen_random_uuid', 'true', exists (select 1 from pg_proc where proname = 'gen_random_uuid')::text
  union all select 'role_anon', 'true', exists (select 1 from pg_roles where rolname = 'anon')::text
  union all select 'role_authenticated', 'true', exists (select 1 from pg_roles where rolname = 'authenticated')::text
  union all select 'role_service_role', 'true', exists (select 1 from pg_roles where rolname = 'service_role')::text
  -- dependências estruturais (as únicas tabelas legadas que as migrations referenciam)
  union all select 'properties.id uuid', 'uuid', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'id')
  union all select 'properties.owner_id uuid', 'uuid', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_id')
  union all select 'properties.archived_at timestamptz', 'timestamp with time zone', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'properties' and column_name = 'archived_at')
  union all select 'property_chat_conversations.id uuid pk', 'true',
    exists (select 1 from pg_constraint where conrelid = 'public.property_chat_conversations'::regclass and contype = 'p'
              and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')::text
  -- nada do Shadow/lease pode existir (aplicação limpa; não há sobreposição com objetos de mesmo nome)
  union all select 'no_guest_ai_relations', '0', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname like 'guest\_ai\_%')
  union all select 'no_shadow_functions', '0', (select count(*)::text from pg_proc p where p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%')
  union all select 'no_lease_functions', '0', (select count(*)::text from pg_proc p where p.proname in ('claim_conversation_lease', 'transition_conversation_lease'))
  -- nenhuma transação longa segurando as tabelas que recebem lock da FK (evita fila de locks)
  union all select 'no_long_tx_on_dependencies', '0', (select count(*)::text from pg_locks l join pg_stat_activity a on a.pid = l.pid
      where l.relation in ('public.property_chat_conversations'::regclass, 'public.properties'::regclass)
        and a.xact_start < now() - interval '30 seconds' and a.pid <> pg_backend_pid())
  -- conexões disponíveis
  union all select 'connections_headroom_ge_10', 'true', ((select setting::int from pg_settings where name = 'max_connections') - (select count(*) from pg_stat_activity) >= 10)::text
  -- o que os DEFAULT PRIVILEGES concederiam (as migrations revogam tabelas, sequências e funções)
  union all select 'default_acl_public_sequences_to_clients', 'informativo', coalesce((select defaclacl::text from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and d.defaclobjtype = 'S' and pg_get_userbyid(d.defaclrole) = current_user), 'nenhum')
)
select check_name, expected, found,
       case when expected in ('informativo', 'qualquer') then true
            when check_name = 'executor_role' then found = 'postgres'
            else found = expected end as ok
  from checks;
