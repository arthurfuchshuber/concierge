-- Agenda a checagem diária automática do anúncio do Airbnb
-- (src/routes/api/public/cron.refresh-airbnb-listings.ts). Mesmo padrão
-- pg_cron + net.http_post + x-cron-secret já usado por refresh-recommendations
-- e refresh-city-news, e o mesmo segredo compartilhado por todos os crons
-- públicos deste projeto (CRON_SECRET). Sem esta agenda, o endpoint existe
-- mas nunca é chamado sozinho.
--
-- Não existe webhook do Airbnb pra hosts individuais (só pra parceiros
-- certificados via Homes API) — isto é o substituto possível: uma vez por
-- dia, cada imóvel com link do Airbnb cadastrado é relido (mesmo mecanismo
-- do botão manual "Importar") e qualquer diferença é aplicada sozinha.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-airbnb-listings-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-airbnb-listings-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-airbnb-listings-daily',
  '30 5 * * *',
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
