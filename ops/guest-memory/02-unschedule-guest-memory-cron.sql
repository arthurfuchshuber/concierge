-- ETAPA B · remove o agendamento do processo pós-checkout (desligamento). Idempotente.
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'guest-memory-hourly') then
    perform cron.unschedule('guest-memory-hourly');
  end if;
end
$cron$;
