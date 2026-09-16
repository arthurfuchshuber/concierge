-- Registra, no momento em que uma limpeza é marcada como concluída (avanço
-- "cleaning" no Kanban/Dashboard), qual tipo foi realizado (normal/completa)
-- e o valor cobrado NAQUELE momento (snapshot em centavos) — assim os cards
-- "Limpezas Realizadas" e "Custo Total Limpeza" ficam corretos mesmo que o
-- valor configurado no imóvel mude depois.
ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS cleaning_type text CHECK (cleaning_type IN ('normal', 'completa')),
  ADD COLUMN IF NOT EXISTS cleaning_price_cents integer;

COMMENT ON COLUMN public.guest_arrival_status.cleaning_type IS 'Tipo de limpeza escolhido ao concluir a faxina: normal ou completa.';
COMMENT ON COLUMN public.guest_arrival_status.cleaning_price_cents IS 'Valor (centavos) cobrado por essa limpeza — snapshot do preço do imóvel no momento da conclusão.';
