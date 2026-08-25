-- O job "ops-push-scan" (varredura de pushs operacionais a cada 30 min)
-- estava tendo timeouts intermitentes do lado do pg_net: o padrão do
-- net.http_post é esperar só 5000ms pela resposta, e a varredura percorre
-- TODOS os proprietários da conta a cada execução — em contas com mais
-- imóveis/proprietários isso pode passar de 5s, mesmo com o endpoint
-- respondendo normalmente (o pg_net só desiste de esperar, não indica que
-- o endpoint falhou). Recriamos o job com um timeout maior (30s) para dar
-- folga suficiente. O código do endpoint também foi otimizado para
-- processar os proprietários em paralelo em vez de um por um.
SELECT cron.unschedule('ops-push-scan')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-push-scan');

SELECT cron.schedule(
  'ops-push-scan',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/ops-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
