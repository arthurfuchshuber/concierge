-- Valores fixos de limpeza (cobrados por diária de faxina), em centavos —
-- mesma convenção de "hourly_rate_cents" usada para prestadores de serviço.
-- Editados juntos com Proprietário/Tipo do imóvel no novo quadrante
-- "Identificação e Custos de Limpeza" (aba "A casa" e popup "Editar imóvel").
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS cleaning_price_normal_cents integer,
  ADD COLUMN IF NOT EXISTS cleaning_price_full_cents integer;

COMMENT ON COLUMN public.properties.cleaning_price_normal_cents IS 'Valor fixo (centavos) cobrado por uma limpeza normal deste imóvel.';
COMMENT ON COLUMN public.properties.cleaning_price_full_cents IS 'Valor fixo (centavos) cobrado por uma limpeza completa deste imóvel.';
