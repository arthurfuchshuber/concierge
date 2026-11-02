-- =====================================================================
-- APLICADA EM 02/11/2026 (autorização do cliente) — retenção da trilha
-- de chamadas de servidor. Registro do que foi executado em produção.
--
-- Contexto medido: `ai_system_events` com 6,5 GB dos ~7 GB do banco; quase
-- tudo `SERVER_CALL` de LEITURA (list…/get…/count…), gerado em boa parte pelo
-- laço de reconexão do tempo real (corrigido no commit 5945a2fc). A partir do
-- código de 02/11 a trilha guarda só AÇÕES (sempre) e leituras com ERRO
-- (`src/lib/audit-fn-middleware.ts`).
--
-- Decisão do cliente: apagar só LEITURAS com mais de 30 dias; AÇÕES ficam
-- para sempre. Erros, integrações, permissões e atividade não são tocados.
--
-- Correção em relação à versão anterior desta proposta: `audit_logs` NÃO está
-- vazia (89.761 linhas de 28/06 a 11/10 — a estatística do banco estava zerada).
-- O VACUUM FULL dela foi retirado: não há espaço morto a devolver e as linhas
-- são histórico.
-- =====================================================================

-- 1. Limpeza inicial (executada em lotes até 0): ~285 mil leituras anteriores
--    a 03/10/2026 apagadas.
DELETE FROM public.ai_system_events
 WHERE id IN (SELECT id FROM public.ai_system_events
               WHERE event_category = 'SERVER_CALL'
                 AND created_at < now() - interval '30 days'
                 AND entity_id ~ '^(list|get|count|check|fetch|search|load|read|lookup|preview|validate|verify|is|has)[A-Z]|^admin(List|Get)[A-Z]|^compare[A-Z]'
               LIMIT 50000);
VACUUM (ANALYZE) public.ai_system_events;

-- 2. Limpeza diária (job 774, 04:23 UTC): mesmos critérios, lotes de 50 mil,
--    até 4 minutos por execução.
SELECT cron.schedule('purge-server-call-reads-daily', '23 4 * * *', $job$
DO $do$
DECLARE n bigint; t0 timestamptz := clock_timestamp();
BEGIN
  LOOP
    DELETE FROM public.ai_system_events
     WHERE id IN (SELECT id FROM public.ai_system_events
                   WHERE event_category = 'SERVER_CALL'
                     AND created_at < now() - interval '30 days'
                     AND entity_id ~ '^(list|get|count|check|fetch|search|load|read|lookup|preview|validate|verify|is|has)[A-Z]|^admin(List|Get)[A-Z]|^compare[A-Z]'
                   LIMIT 50000);
    GET DIAGNOSTICS n = ROW_COUNT;
    EXIT WHEN n = 0 OR clock_timestamp() - t0 > interval '4 minutes';
  END LOOP;
END $do$;
$job$);

-- 3. Autores recuperados da trilha (3 check-ins confirmados pela equipe, os
--    únicos com a chamada registrada):
UPDATE public.guest_arrival_status
   SET manual_created_by = '25239e5b-1a66-46f1-b9a2-829c499cc366'
 WHERE id IN ('430b5f58-8fbb-42fb-98b1-283b144b07ac',
              '6054d77a-b5db-4780-87a7-cd13876f34e8',
              '6727f456-660f-4a3e-9da8-4e6da05722ba')
   AND manual_created_by IS NULL AND note = 'Confirmado pela equipe';

-- Reversão: 2 → SELECT cron.unschedule('purge-server-call-reads-daily');
--           3 → UPDATE public.guest_arrival_status SET manual_created_by = NULL
--               WHERE id IN (os 3 acima);
--           1 → sem reversão (registros de leitura, não dados operacionais).
-- Observação: o regex acima precisa acompanhar `READ_NAME` em audit-fn-middleware.ts.
