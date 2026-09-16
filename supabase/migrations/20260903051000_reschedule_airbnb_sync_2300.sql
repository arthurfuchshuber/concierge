-- Muda o horário da checagem diária do Airbnb para 23h00 no horário de
-- Brasília (pedido do cliente em 03/09/2026). O pg_cron roda no fuso do
-- banco (UTC), e Brasília é UTC-3 (sem horário de verão desde 2019) — então
-- 23:00 BRT = 02:00 UTC do dia seguinte, daí '0 2 * * *' abaixo. Mesmo
-- padrão de reagendamento já usado: apaga o job existente (se houver) e
-- recria com o novo horário — nome do job (jobname) continua o mesmo, então
-- isto não duplica execuções.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-airbnb-listings-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-airbnb-listings-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-airbnb-listings-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/refresh-airbnb-listings',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{"limit": 100}'::jsonb
  ) AS request_id;
  $$
);
