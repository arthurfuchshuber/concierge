-- lovable-cron-fallback-reviewed: user explicitly required 1-minute automatic retry of Channex ARI outbox for certification; endpoint only flushes due pending rows
SELECT cron.unschedule('channex-ari-retry') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'channex-ari-retry');
SELECT cron.schedule('channex-ari-retry','* * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/channex-ari-retry',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000) AS request_id;
$$);
