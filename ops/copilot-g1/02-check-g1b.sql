-- G1b: conferência SÓ LEITURA (SELECT em catálogos).
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (p.proname like 'copilot%' or p.proname like 'guest_ai_copilot%')
 order by p.proname;
-- Esperado: nenhuma linha com anon ou authenticated = true; copilot_edit, copilot_discard, copilot_claim_send,
-- copilot_finish_send e copilot_reconcile_send ausentes.
