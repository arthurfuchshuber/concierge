-- =====================================================================
-- PROPOSTA (NÃO APLICADA) — retenção da trilha de chamadas de servidor
-- ConciergeIA · auditoria de lentidão de 02/11/2026
--
-- NÃO ESTÁ EM supabase/migrations DE PROPÓSITO: só roda com autorização.
--
-- PROBLEMA MEDIDO:
--   · `ai_system_events` tem 6,5 GB dos ~7 GB do banco; 6,1 milhões de linhas
--     são `SERVER_CALL` (uma linha por chamada de server function, desde 04/08);
--   · ~160 mil novas linhas por dia, cada uma mantendo 8 índices;
--   · até um COUNT na tabela estoura o tempo da API (504).
--   · `audit_logs` ocupa 144 MB com 0 linhas (espaço morto nunca devolvido).
--
-- O QUE FAZ (o resto da trilha — erros, integrações, permissões, atividade —
-- NÃO é tocado):
--   1. Apaga, em lotes, só as linhas `SERVER_CALL` mais antigas que a janela.
--   2. Agenda a mesma limpeza diária (SQL puro no pg_cron, sem HTTP).
--   3. Devolve ao disco o espaço morto de `audit_logs` (tabela vazia).
--
-- DECISÃO SUA: a janela de retenção. Proposta: 30 dias. Troque o valor em
-- `janela` nos dois lugares abaixo se quiser outro prazo.
-- Sem reversão possível para as linhas apagadas: são só registros de
-- "quem chamou qual função", não dados operacionais.
-- =====================================================================

-- 1. Limpeza inicial em lotes (repetir até "apagadas: 0"; cada lote é curto
--    e usa o índice ai_system_events_category_idx).
DO $$
DECLARE janela interval := interval '30 days'; n bigint; total bigint := 0;
BEGIN
  LOOP
    DELETE FROM public.ai_system_events
     WHERE id IN (SELECT id FROM public.ai_system_events
                   WHERE event_category = 'SERVER_CALL' AND created_at < now() - janela
                   LIMIT 50000);
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    EXIT WHEN n = 0 OR total >= 2000000;  -- teto por execução; rode de novo se precisar
  END LOOP;
  RAISE NOTICE 'apagadas: %', total;
END $$;

VACUUM (ANALYZE) public.ai_system_events;

-- 2. Limpeza diária (04:23 UTC), em lote único de até 300 mil linhas
SELECT cron.schedule(
  'purge-server-call-audit-daily',
  '23 4 * * *',
  $job$
    DELETE FROM public.ai_system_events
     WHERE id IN (SELECT id FROM public.ai_system_events
                   WHERE event_category = 'SERVER_CALL' AND created_at < now() - interval '30 days'
                   LIMIT 300000);
  $job$
);

-- 3. Espaço morto de audit_logs (0 linhas; trava a tabela por instantes)
VACUUM FULL public.audit_logs;

-- Reversão do item 2: SELECT cron.unschedule('purge-server-call-audit-daily');
