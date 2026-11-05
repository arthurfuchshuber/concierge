-- ConciergeIA Guest AI · Entrega 4 · ROLLBACK
-- 03b · DESFAZ TUDO (escopo global + Shadow + lease B3.1). Transacional: rodar inteiro dentro de BEGIN/COMMIT.
-- Remove SÓ objetos guest_ai_*/shadow_* e as 2 funções do lease (nomes conferidos pelo preflight antes da
-- aplicação); SEM CASCADE (qualquer dependência inesperada interrompe). Não toca em tabela legada.
-- Perde: telemetria do Shadow (códigos e números; sem dado pessoal), orçamento, leases.
do $$
declare v_cron boolean := false;
begin
  if exists (select 1 from public.guest_ai_shadow_control where state in ('ready', 'running')) then
    raise exception 'rollback interrompido: Shadow ativo (rode shadow_emergency_stop antes)' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.guest_ai_shadow_inflight where status = 'running') then
    raise exception 'rollback interrompido: execução em andamento (aguarde o prazo e rode shadow_admin_reconcile)' using errcode = 'P0001';
  end if;
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where command ilike ''%shadow-tick%'')' into v_cron;
  end if;
  if v_cron then
    raise exception 'rollback interrompido: remova antes o agendamento do Shadow (cron.unschedule)' using errcode = 'P0001';
  end if;
end $$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'shadow\_%' or p.proname like 'guest\_ai\_shadow\_%'
                   or p.proname in ('claim_conversation_lease', 'transition_conversation_lease')) loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;
-- E4 global (existem se a migration global foi aplicada; ausentes se o 03a já rodou)
drop table if exists public.guest_ai_shadow_property_eligibility;
drop table if exists public.guest_ai_shadow_switch_log;
drop table if exists public.guest_ai_shadow_property_switch;
drop table if exists public.guest_ai_shadow_tenant_switch;
drop table public.guest_ai_shadow_inflight;
drop table public.guest_ai_shadow_access_log;
drop table public.guest_ai_shadow_executions;
drop table public.guest_ai_shadow_budget_reservations;
drop table public.guest_ai_shadow_budget_days;
drop table public.guest_ai_shadow_transitions;
drop table public.guest_ai_shadow_control;
drop table public.guest_ai_conversation_leases;
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'guest\_ai\_%') then
    raise exception 'rollback incompleto: restaram objetos guest_ai_*' using errcode = 'P0001';
  end if;
end $$;
