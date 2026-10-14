-- Desativar anúncio na ficha do proprietário = parar de sincronizar, mantendo os dados já importados.
ALTER TABLE public.property_listing_raw_data ADD COLUMN IF NOT EXISTS sync_paused_at timestamptz;
