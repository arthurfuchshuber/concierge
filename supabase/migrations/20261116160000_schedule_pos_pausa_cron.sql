-- Agenda o job "pos-pausa-5min": varredura pós-pausa (`runPostPauseSweep`, rota /api/public/cron/pos-pausa).
-- A IA volta nas mensagens do hóspede que chegaram durante a pausa humana e ficaram sem resposta.
-- Cadência de 5 minutos, mesmo padrão e mesmo segredo (`cron_secret` do Vault) dos demais crons. Idempotente.
SELECT cron.unschedule('pos-pausa-5min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pos-pausa-5min');

SELECT cron.schedule(
  'pos-pausa-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/pos-pausa',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $$
);
