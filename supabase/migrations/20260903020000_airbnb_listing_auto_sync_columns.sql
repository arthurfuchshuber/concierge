-- Sincronização automática diária do anúncio do Airbnb (não confundir com
-- airbnb_ical_* — aquilo é só o calendário de reservas; isto é o CONTEÚDO do
-- anúncio: nome, descrição, cidade, país, horários, fotos). Mesmo padrão de
-- 3 colunas já usado pro iCal (last_sync_at / last_error), mais uma quarta
-- (last_sync_note) com um resumo em português do que mudou na última
-- checagem, pra o anfitrião ver na tela sem precisar adivinhar.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS airbnb_listing_last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS airbnb_listing_last_error TEXT,
  ADD COLUMN IF NOT EXISTS airbnb_listing_last_sync_note TEXT;
