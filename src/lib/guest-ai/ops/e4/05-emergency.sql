-- ConciergeIA Guest AI · Entrega 4 · PROCEDIMENTO DE EMERGÊNCIA (executar como o dono das funções,
-- no SQL do banco). Cada passo é independente, idempotente e não exige alteração de código. Nenhum passo
-- toca a Capacidade B. Substituir :actor pelo UUID do operador (auditoria) e :property/:tenant quando
-- indicado. Nenhum passo grava texto livre ou dado pessoal.

-- E1 · PARAR TUDO (global): running/ready ⇒ paused; trava do tick liberada; novas reivindicações e
--      reservas recusadas na hora (o banco exige running). Execuções em andamento terminam e liquidam.
select public.shadow_emergency_stop(:'actor'::uuid);

-- E2 · DESABILITAR UM IMÓVEL (sem versão; nunca bloqueado). O tick deixa de vê-lo e a reivindicação
--      recusa `property_disabled` imediatamente.
select public.shadow_set_property_enabled(:'actor'::uuid, :'property'::uuid, :'tenant'::uuid, false, null, 'emergency_disable', null);

-- E3 · SUSPENDER O CRON (se já existir). Reversível; não apaga histórico.
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'guest-ai-shadow-tick';

-- E4 · CONFERIR QUE NADA NOVO COMEÇA E O QUE AINDA ESTÁ EM ANDAMENTO (leitura)
select state, state_version, tick_owner_token is null as tick_free from public.guest_ai_shadow_control;
select count(*) filter (where status = 'running') as em_andamento,
       min(started_at) filter (where status = 'running') as mais_antiga
  from public.guest_ai_shadow_inflight;

-- E5 · RECONCILIAR ABANDONADAS (depois do prazo do lease, 30 s): sela o lote, liquida a reserva pelo pior
--      caso e registra `worker_lost`. Execuções com lease válido NÃO são tocadas; repetir é seguro.
select public.shadow_admin_reconcile(:'actor'::uuid);

-- E6 · CONFERIR ORÇAMENTO E CONTABILIDADE (leitura): agregado do dia = soma das reservas
select d.budget_day, d.reserved_cost, d.settled_cost, d.open_reservations,
       (select count(*) from public.guest_ai_shadow_budget_reservations r where r.budget_day = d.budget_day and r.status = 'open') as abertas
  from public.guest_ai_shadow_budget_days d order by d.budget_day desc limit 3;

-- E7 · REGISTRO DA OCORRÊNCIA: as transições (autor, motivo, horário) e o histórico das habilitações já
--      ficam gravados pelas funções acima; não há campo de texto livre. Consulta:
select from_state, to_state, actor, automatic, reason_code, at from public.guest_ai_shadow_transitions order by id desc limit 10;
select property_id, from_enabled, to_enabled, actor, db_role, reason_code, at from public.guest_ai_shadow_property_switch_log order by id desc limit 10;

-- RELIGAMENTO: NUNCA automático. Exige autorização explícita e o caminho administrativo com CAS:
--   paused ⇒ running:   select public.shadow_transition(<versão>, 'running', :'actor'::uuid, 'authorized_resume');
--   estado de falha ⇒ ready (com referência da correção): shadow_transition(<versão>, 'ready', :'actor', 'authorized_recovery', '<sha256>')
--   imóvel:             shadow_set_property_enabled(..., true, <versão>, 'pilot_enable', '<sha256 da autorização>')
