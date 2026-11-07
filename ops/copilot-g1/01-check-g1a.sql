-- G1a: conferência SÓ LEITURA (SELECT em catálogos).
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role,
       position('generation_timeout' in pg_get_functiondef(p.oid)) > 0 as tem_expiracao,
       position('message_mismatch' in pg_get_functiondef(p.oid)) > 0 as finish_estrito
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'copilot%'
 order by p.proname;
-- Esperado: 5 copilot_actor_* só service_role; copilot_claim_generation com tem_expiracao = true;
-- copilot_actor_finish_send com finish_estrito = true; as 5 antigas ainda com authenticated = true.
