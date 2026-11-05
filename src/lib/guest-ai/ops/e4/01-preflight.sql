-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · PREFLIGHT (somente leitura). Rodar no banco ALVO
-- antes de aplicar 20261104000000_guest_ai_conversation_leases.sql, 20261104120000_guest_ai_shadow.sql e
-- 20261105120000_guest_ai_shadow_global.sql. Cada linha: verificação, esperado, encontrado, ok.
-- Critério de interrupção: QUALQUER linha com ok = false ⇒ NÃO aplicar.
with col(t, c) as (
  select table_name::text, column_name::text || ':' || data_type::text from information_schema.columns where table_schema = 'public'
), checks(check_name, expected, found) as (
  select 'postgres_major', '17', split_part(current_setting('server_version'), '.', 1)
  union all select 'executor_role', 'postgres (dono das funções SECURITY DEFINER)', current_user::text
  union all select 'executor_not_superuser_ok', 'qualquer', (select rolsuper::text from pg_roles where rolname = current_user)
  union all select 'executor_can_create_in_public', 'true', has_schema_privilege(current_user, 'public', 'CREATE')::text
  union all select 'timezone_sao_paulo', 'true', exists (select 1 from pg_timezone_names where name = 'America/Sao_Paulo')::text
  union all select 'gen_random_uuid', 'true', exists (select 1 from pg_proc where proname = 'gen_random_uuid')::text
  union all select 'role_anon', 'true', exists (select 1 from pg_roles where rolname = 'anon')::text
  union all select 'role_authenticated', 'true', exists (select 1 from pg_roles where rolname = 'authenticated')::text
  union all select 'role_service_role', 'true', exists (select 1 from pg_roles where rolname = 'service_role')::text
  -- dependências estruturais: as tabelas legadas que as migrations e a elegibilidade leem (colunas e tipos)
  union all select 'properties.cols', 'archived_at:timestamp with time zone,checkin_time:text,checkout_time:text,guide_created:boolean,id:uuid,owner_id:uuid,published:boolean',
    (select string_agg(c, ',' order by c) from col where t = 'properties' and split_part(c, ':', 1) in ('id', 'owner_id', 'archived_at', 'published', 'guide_created', 'checkin_time', 'checkout_time'))
  union all select 'property_chat_conversations.cols', 'guest_session_id:text,id:uuid,last_message_at:timestamp with time zone,property_id:uuid',
    (select string_agg(c, ',' order by c) from col where t = 'property_chat_conversations' and split_part(c, ':', 1) in ('id', 'property_id', 'guest_session_id', 'last_message_at'))
  union all select 'property_chat_conversations.id uuid pk', 'true',
    exists (select 1 from pg_constraint where conrelid = 'public.property_chat_conversations'::regclass and contype = 'p'
              and pg_get_constraintdef(oid) = 'PRIMARY KEY (id)')::text
  union all select 'property_chat_messages.cols', 'conversation_id:uuid,created_at:timestamp with time zone,id:uuid,role:text',
    (select string_agg(c, ',' order by c) from col where t = 'property_chat_messages' and split_part(c, ':', 1) in ('id', 'conversation_id', 'created_at', 'role'))
  union all select 'property_chat_messages.sender_type_has_guest', 'true',
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'property_chat_messages' and column_name = 'sender_type'))::text
  union all select 'profiles.id', 'id:uuid', (select string_agg(c, ',') from col where t = 'profiles' and c like 'id:%')
  union all select 'property_listing_raw_data.cols', 'airbnb_listing_id:text,channex_property_id:text,not_found_at:timestamp with time zone,owner_id:uuid,paused_reason:text,property_id:uuid,sync_paused_at:timestamp with time zone',
    (select string_agg(c, ',' order by c) from col where t = 'property_listing_raw_data' and split_part(c, ':', 1) in ('property_id', 'owner_id', 'airbnb_listing_id', 'channex_property_id', 'not_found_at', 'sync_paused_at', 'paused_reason'))
  union all select 'channex_twin_links.cols', 'owner_id:uuid,property_id:uuid,status:text',
    (select string_agg(c, ',' order by c) from col where t = 'channex_twin_links' and split_part(c, ':', 1) in ('property_id', 'owner_id', 'status'))
  union all select 'host_whatsapp_config.cols', 'owner_id:uuid,status:text',
    (select string_agg(c, ',' order by c) from col where t = 'host_whatsapp_config' and split_part(c, ':', 1) in ('owner_id', 'status'))
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
  -- informativos: o que os DEFAULT PRIVILEGES concederiam (as migrations revogam) e os índices da escolha de candidatas
  union all select 'default_acl_public_sequences_to_clients', 'informativo', coalesce((select defaclacl::text from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
      where n.nspname = 'public' and d.defaclobjtype = 'S' and pg_get_userbyid(d.defaclrole) = current_user), 'nenhum')
  union all select 'index_conversations_last_message_at', 'informativo',
    coalesce((select string_agg(indexname, ',') from pg_indexes where schemaname = 'public' and tablename = 'property_chat_conversations' and indexdef ilike '%last_message_at%'), 'nenhum')
  union all select 'index_messages_conversation_created', 'informativo',
    coalesce((select string_agg(indexname, ',') from pg_indexes where schemaname = 'public' and tablename = 'property_chat_messages' and indexdef ilike '%conversation_id%'), 'nenhum')
)
select check_name, expected, found,
       case when expected in ('informativo', 'qualquer') then true
            when check_name = 'executor_role' then found = 'postgres'
            else found = expected end as ok
  from checks;
