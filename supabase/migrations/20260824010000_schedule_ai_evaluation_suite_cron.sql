-- Agenda a execução diária do motor de avaliação/regressão de IA
-- (src/routes/api/public/cron.evaluation-suite.ts).
--
-- O endpoint já existe e já é seguro por padrão: ele só roda de verdade
-- quando a env var AI_EVALUATION_PROPERTY_IDS estiver configurada (lista de
-- UUIDs de imóveis dedicados a QA) — sem ela, responde no-op e avisa no log,
-- em vez de escolher uma propriedade real "no escuro". O que faltava era
-- justamente isto: nada nunca chamava o endpoint, então mesmo com a env var
-- configurada a suíte de regressão nunca rodaria sozinha. Este agendamento
-- fecha essa lacuna, no mesmo padrão pg_cron + net.http_post + x-cron-secret
-- já usado pelos demais crons deste projeto.
--
-- IMPORTANTE: configurar AI_EVALUATION_PROPERTY_IDS com UUID(s) reais de
-- imóveis de QA continua sendo uma etapa manual, feita no painel de secrets
-- do projeto — não é algo que uma migração de banco possa/deva decidir.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('ai-evaluation-suite-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-evaluation-suite-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ai-evaluation-suite-daily',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/evaluation-suite',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
