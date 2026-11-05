-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · Gate A · FOTOGRAFIA DA CAPACIDADE B (somente leitura).
-- Rodar IMEDIATAMENTE ANTES do gateA-bundle.sql e IMEDIATAMENTE DEPOIS do 02-validate. Os 9 valores precisam ser
-- IDÊNTICOS. Exclui só objetos do Guest AI (guest_ai_* e as funções shadow_* / *_conversation_lease).
-- Cobre: colunas e defaults, ACL+RLS de tabelas/visões/sequências, políticas, gatilhos, índices, constraints,
-- funções do legado (corpo + ACL) e os jobs do pg_cron (nome, agenda, ativo, comando).
select
 (select md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), '|' order by table_name, ordinal_position))
    from information_schema.columns where table_schema='public' and table_name not like 'guest\_ai\_%') as fp_colunas,
 (select md5(string_agg(c.relname::text||':'||c.relkind::text||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''), '|' order by c.relname))
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind in ('r','v','m','S','p') and c.relname not like 'guest\_ai\_%') as fp_acl_rls,
 (select md5(string_agg(tablename||':'||policyname||':'||cmd||':'||array_to_string(roles,',')||':'||coalesce(qual,'')||':'||coalesce(with_check,''), '|' order by tablename, policyname))
    from pg_policies where schemaname='public') as fp_politicas,
 (select md5(string_agg(c.relname::text||':'||t.tgname::text||':'||pg_get_triggerdef(t.oid), '|' order by c.relname, t.tgname))
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and not t.tgisinternal) as fp_gatilhos,
 (select md5(string_agg(indexname||':'||indexdef, '|' order by indexname))
    from pg_indexes where schemaname='public' and tablename not like 'guest\_ai\_%') as fp_indices,
 (select md5(string_agg(c.relname::text||':'||k.conname::text||':'||pg_get_constraintdef(k.oid), '|' order by c.relname, k.conname))
    from pg_constraint k join pg_class c on c.oid=k.conrelid
   where k.connamespace='public'::regnamespace and c.relname not like 'guest\_ai\_%') as fp_constraints,
 (select md5(string_agg(p.oid::regprocedure::text||':'||md5(p.prosrc)||':'||coalesce(p.proacl::text,''), '|' order by p.oid::regprocedure::text))
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname not like 'shadow\_%' and p.proname not like 'guest\_ai\_shadow\_%'
     and p.proname not in ('claim_conversation_lease','transition_conversation_lease')) as fp_funcoes_legado,
 (select case when to_regclass('cron.job') is null then 'sem_pg_cron'
         else (xpath('/row/f/text()', query_to_xml('select md5(string_agg(jobname||'':''||schedule||'':''||active::text||'':''||md5(command), ''|'' order by jobname)) as f from cron.job', false, true, '')))[1]::text end) as fp_cron,
 (select case when to_regclass('cron.job') is null then '0'
         else (xpath('/row/c/text()', query_to_xml('select count(*) as c from cron.job where active', false, true, '')))[1]::text end) as cron_ativos_total;
