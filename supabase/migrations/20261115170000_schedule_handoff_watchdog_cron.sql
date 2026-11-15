-- Agenda o job "handoff-watchdog-5min": vigia de encaminhamentos sem resposta
-- (`runHandoffWatchdog`, rota /api/public/cron/handoff-watchdog). Cadência de 5 minutos,
-- mesmo padrão e mesmo segredo (`cron_secret` do Vault) dos demais crons. Idempotente.
SELECT cron.unschedule('handoff-watchdog-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'handoff-watchdog-5min');

SELECT cron.schedule(
  'handoff-watchdog-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/handoff-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
