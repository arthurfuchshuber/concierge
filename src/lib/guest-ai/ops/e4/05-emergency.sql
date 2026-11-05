-- ConciergeIA Guest AI · Entrega 4 (revisão GLOBAL) · PROCEDIMENTO DE EMERGÊNCIA (executar como o dono das
-- funções, no SQL do banco). Cada passo é independente, idempotente e não exige alteração de código.
-- Nenhum passo toca a Capacidade B. Substituir :actor pelo UUID do operador (auditoria) e :tenant/:property
-- quando indicado. Nenhum passo grava texto livre ou dado pessoal. Desligar NUNCA é bloqueado.

-- E1 · PARAR TUDO (global): running/ready ⇒ paused; trava do tick liberada; novas reivindicações, reservas e
--      escolhas de candidatas recusadas na hora (o banco exige running). Execuções em andamento terminam e liquidam.
select public.shadow_emergency_stop(:'actor'::uuid);

-- E1b · FECHAR O ESCOPO (todos os imóveis saem; independe do estado global). Sem versão: nunca bloqueado.
select public.shadow_set_scope(:'actor'::uuid, null, 'none', 'emergency_scope_off');

-- E2 · DESLIGAR UM TENANT inteiro (todos os imóveis dele saem; os demais tenants seguem). Sem versão.
select public.shadow_set_tenant_enabled(:'actor'::uuid, :'tenant'::uuid, false, null, 'emergency_disable');

-- E2b · DESLIGAR UM IMÓVEL (só ele sai). Sem versão. Aceito mesmo se o imóvel já foi excluído.
select public.shadow_set_property_enabled(:'actor'::uuid, :'property'::uuid, :'tenant'::uuid, false, null, 'emergency_disable');

-- E3 · SUSPENDER O CRON (se já existir). Reversível; não apaga histórico.
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'guest-ai-shadow-tick';

-- E4 · CONFERIR QUE NADA NOVO COMEÇA E O QUE AINDA ESTÁ EM ANDAMENTO (leitura)
select state, state_version, property_scope, scope_version, tick_owner_token is null as tick_free from public.guest_ai_shadow_control;
select count(*) filter (where status = 'running') as em_andamento,
       min(started_at) filter (where status = 'running') as mais_antiga
  from public.guest_ai_shadow_inflight;
select count(*) as imoveis_ativos from public.properties p where public.guest_ai_shadow_property_gate(p.owner_id, p.id) is null;

-- E5 · RECONCILIAR ABANDONADAS (depois do prazo do lease, 30 s): sela o lote, liquida a reserva pelo pior
--      caso e registra `worker_lost`. Execuções com lease válido NÃO são tocadas; repetir é seguro.
select public.shadow_admin_reconcile(:'actor'::uuid);

-- E6 · CONFERIR ORÇAMENTO E CONTABILIDADE (leitura): agregado do dia = soma das reservas
select d.budget_day, d.reserved_cost, d.settled_cost, d.open_reservations,
       (select count(*) from public.guest_ai_shadow_budget_reservations r where r.budget_day = d.budget_day and r.status = 'open') as abertas
  from public.guest_ai_shadow_budget_days d order by d.budget_day desc limit 3;

-- E7 · REGISTRO DA OCORRÊNCIA: transições (autor, motivo, horário) e mudanças de escopo/interruptores já ficam
--      gravadas pelas funções acima; não há campo de texto livre. Consulta:
select from_state, to_state, actor, automatic, reason_code, at from public.guest_ai_shadow_transitions order by id desc limit 10;
select subject_kind, tenant_id, property_id, from_value, to_value, actor, db_role, reason_code, at
  from public.guest_ai_shadow_switch_log order by id desc limit 20;

-- RELIGAMENTO: NUNCA automático. Exige autorização explícita e o caminho administrativo com CAS + evidência:
--   paused ⇒ running:   select public.shadow_transition(<versão>, 'running', :'actor'::uuid, 'authorized_resume');
--   estado de falha ⇒ ready (com referência da correção): shadow_transition(<versão>, 'ready', :'actor', 'authorized_recovery', '<sha256>')
--   escopo:             shadow_set_scope(:'actor', <versão do escopo>, 'all_eligible', 'authorized_global_activation', '<sha256>')
--   tenant / imóvel:    shadow_set_tenant_enabled(..., true, <versão>, 'authorized_enable', '<sha256>') /
--                       shadow_set_property_enabled(..., true, <versão>, 'authorized_enable', '<sha256>')
