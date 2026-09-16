-- Agenda a execução periódica do concierge proativo
-- (src/routes/api/public/cron.proactive-concierge.ts).
--
-- Este endpoint já existia e já fazia duas coisas: (1) varria reservas e
-- gerava as ações proativas em ai_proactive_actions, aprovando sozinho as de
-- autonomia "low"; (2), a partir desta correção, também envia de verdade as
-- ações de baixa autonomia que são mensagens ao hóspede (boas-vindas antes
-- do check-in, instruções de saída, "tudo bem?" para hóspede silencioso),
-- via sendApprovedProactiveActions. Nenhuma das duas etapas nunca rodava
-- sozinha: sem esta agenda, nada nunca chamava o endpoint. Roda a cada hora
-- — frequência suficiente para as janelas de 24-48h das regras, sem gerar
-- carga desnecessária.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('proactive-concierge-hourly')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proactive-concierge-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'proactive-concierge-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/proactive-concierge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
