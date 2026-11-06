-- ETAPA B · agenda o processo pós-checkout da memória do hóspede (a cada hora, minuto 17; até 10 estadias).
-- NÃO aplicar sem autorização específica do titular. Pré-requisitos no README desta pasta.
-- Idempotente: remove o agendamento anterior com o mesmo nome antes de criar.
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'guest-memory-hourly') then
    perform cron.unschedule('guest-memory-hourly');
  end if;
  perform cron.schedule(
    'guest-memory-hourly',
    '17 * * * *',
    $job$
    select net.http_post(
      url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/guest-memory',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := jsonb_build_object('limit', 10)
    ) as request_id;
    $job$
  );
end
$cron$;
