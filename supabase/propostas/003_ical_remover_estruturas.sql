-- =====================================================================
-- PROPOSTA (NÃO APLICADA) — remover as estruturas de banco do iCal
-- ConciergeIA · 02/11/2026 · complementa o commit que tirou o iCal do código
--
-- NÃO ESTÁ EM supabase/migrations DE PROPÓSITO: só roda com autorização.
--
-- CONFERIDO ANTES (somente leitura, 02/11/2026):
--   · nenhum código do app lê ou grava mais estas colunas (só o tipo gerado
--     `src/integrations/supabase/types.ts`, que o Lovable regenera);
--   · nenhuma função, view ou política do banco cita `airbnb_ical*` ou
--     `feed_index`; o índice abaixo só servia à sincronização apagada;
--   · cron 682 `sync-airbnb-ical-30min` está inativo e a rota que ele chamava
--     não existe mais;
--   · dados: 32 imóveis com link, 44 com data de última sincronização, 0 com erro.
--
-- O QUE SAI
--   1. o job 682 do pg_cron;
--   2. o índice `idx_property_reservations_feed`;
--   3. as colunas `properties.airbnb_ical_url`, `airbnb_ical_url_2`,
--      `airbnb_ical_last_sync_at`, `airbnb_ical_last_error`.
--
-- O QUE FICA (histórico e rastreabilidade)
--   · TODAS as linhas de `property_reservations` (inclusive `source='airbnb'`),
--     com `external_uid`, `guest_hint` (código HM), datas, status e `synced_at`;
--   · `property_reservations.feed_index` (de qual dos dois links do anfitrião
--     veio cada reserva histórica: 450 linhas = 0, 2 linhas = 1);
--   · o gatilho `trg_unify_ical_channex_stay` / `merge_duplicate_stay`, que une
--     uma reserva histórica à reserva da API da mesma estadia. ATENÇÃO: ele
--     casa só por imóvel + datas e apaga o cartão duplicado — substituí-lo
--     (casar por código HM, sem apagar) é a etapa L3 do plano de
--     descontinuação, a fazer ANTES de os 32 imóveis se conectarem pela API.
--
-- REVERSÃO: o passo 0 guarda os valores das colunas numa tabela de backup
-- (somente o service_role lê). O bloco no fim recria colunas, valores, índice
-- e job. Os links são credenciais privadas do anfitrião: se preferir não
-- guardá-los, apague a tabela de backup depois de confirmar que está tudo bem.
-- =====================================================================

BEGIN;

-- 0. Backup das colunas (para reversão)
CREATE TABLE IF NOT EXISTS public._ical_properties_backup_20261102 AS
  SELECT id, airbnb_ical_url, airbnb_ical_url_2, airbnb_ical_last_sync_at, airbnb_ical_last_error
    FROM public.properties
   WHERE airbnb_ical_url IS NOT NULL OR airbnb_ical_url_2 IS NOT NULL
      OR airbnb_ical_last_sync_at IS NOT NULL OR airbnb_ical_last_error IS NOT NULL;
ALTER TABLE public._ical_properties_backup_20261102 ENABLE ROW LEVEL SECURITY; -- sem políticas

-- 1. Job do pg_cron
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sync-airbnb-ical-30min';

-- 2. Índice exclusivo da sincronização
DROP INDEX IF EXISTS public.idx_property_reservations_feed;

-- 3. Colunas do link e do estado da sincronização
ALTER TABLE public.properties
  DROP COLUMN IF EXISTS airbnb_ical_url,
  DROP COLUMN IF EXISTS airbnb_ical_url_2,
  DROP COLUMN IF EXISTS airbnb_ical_last_sync_at,
  DROP COLUMN IF EXISTS airbnb_ical_last_error;

-- conferência: nenhuma reserva foi tocada
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM public.property_reservations;
  RAISE NOTICE 'reservas preservadas: %', n;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='properties' AND column_name LIKE 'airbnb_ical%') THEN
    RAISE EXCEPTION 'sobrou coluna airbnb_ical* — revertendo';
  END IF;
END $$;

COMMIT;

-- =====================================================================
-- REVERSÃO (só se necessário)
-- =====================================================================
-- BEGIN;
-- ALTER TABLE public.properties
--   ADD COLUMN IF NOT EXISTS airbnb_ical_url text,
--   ADD COLUMN IF NOT EXISTS airbnb_ical_url_2 text,
--   ADD COLUMN IF NOT EXISTS airbnb_ical_last_sync_at timestamptz,
--   ADD COLUMN IF NOT EXISTS airbnb_ical_last_error text;
-- UPDATE public.properties p SET
--   airbnb_ical_url = b.airbnb_ical_url, airbnb_ical_url_2 = b.airbnb_ical_url_2,
--   airbnb_ical_last_sync_at = b.airbnb_ical_last_sync_at, airbnb_ical_last_error = b.airbnb_ical_last_error
--   FROM public._ical_properties_backup_20261102 b WHERE b.id = p.id;
-- CREATE INDEX IF NOT EXISTS idx_property_reservations_feed ON public.property_reservations (property_id, feed_index);
-- -- o job só faz sentido se o código do iCal também voltar (a rota foi removida):
-- -- SELECT cron.schedule('sync-airbnb-ical-30min', '*/30 * * * *', $$ ...comando original... $$);
-- COMMIT;
