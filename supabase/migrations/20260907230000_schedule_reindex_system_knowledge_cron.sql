-- Agenda o job "reindex-system-knowledge": sobe para `ai_system_docs` o
-- conhecimento que o extrator gerou no build, alimentando o Assistente do
-- Painel (pedido explícito, 07/09/2026). Ver `reindexSystemKnowledge` em
-- `src/lib/ai/system-knowledge.server.ts`.
--
-- Cadência de 1 hora, e não de minutos: o conteúdo só muda quando um deploy
-- novo entra no ar, então varrer com mais frequência gastaria chamada à toa.
-- A execução compara `content_hash` antes de gerar embedding — numa hora sem
-- deploy ela lê uma lista de hashes e encerra, sem custo de IA.
--
-- Uma hora também é o atraso máximo entre publicar uma entrega e o assistente
-- saber dela. Para eliminar essa janela, basta chamar o mesmo endpoint no fim
-- do deploy; o job de hora em hora é a rede de segurança para quando isso não
-- acontecer.
--
-- Timeout maior que o dos outros jobs (120s): a primeira execução gera
-- embedding de toda a base de uma vez.
SELECT cron.unschedule('reindex-system-knowledge')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reindex-system-knowledge');

SELECT cron.schedule(
  'reindex-system-knowledge',
  '17 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/reindex-system-knowledge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);
