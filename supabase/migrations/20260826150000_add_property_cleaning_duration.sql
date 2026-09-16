-- Período estimado de limpeza (em minutos, múltiplos de 30) — passa a viver
-- junto dos valores fixos de limpeza no novo quadrante exclusivo "Custos e
-- Duração da Limpeza" (separado da Identificação do imóvel).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS cleaning_duration_minutes integer;

COMMENT ON COLUMN public.properties.cleaning_duration_minutes IS 'Tempo estimado (em minutos, múltiplos de 30) para a limpeza deste imóvel.';
