-- Cada tipo de limpeza (normal / completa) passa a ter seu próprio prazo
-- estimado — uma limpeza completa costuma levar mais tempo que uma normal,
-- então um único "cleaning_duration_minutes" pra ambos os tipos não fazia
-- sentido. Substitui esse campo por dois, um por tipo.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS cleaning_duration_normal_minutes integer,
  ADD COLUMN IF NOT EXISTS cleaning_duration_full_minutes integer;

COMMENT ON COLUMN public.properties.cleaning_duration_normal_minutes IS 'Tempo estimado (em minutos, múltiplos de 30) para uma limpeza normal deste imóvel.';
COMMENT ON COLUMN public.properties.cleaning_duration_full_minutes IS 'Tempo estimado (em minutos, múltiplos de 30) para uma limpeza completa deste imóvel.';

-- Migra o valor único existente pra "normal" (era o único período combinado
-- até agora) — evita perder o que já tinha sido preenchido.
UPDATE public.properties
SET cleaning_duration_normal_minutes = cleaning_duration_minutes
WHERE cleaning_duration_minutes IS NOT NULL
  AND cleaning_duration_normal_minutes IS NULL;

-- Campo antigo (não usado mais pela interface) permanece por segurança —
-- pode ser removido numa limpeza futura depois de confirmar a migração dos
-- dados acima.
COMMENT ON COLUMN public.properties.cleaning_duration_minutes IS 'Obsoleto — substituído por cleaning_duration_normal_minutes / cleaning_duration_full_minutes. Mantido apenas para não perder dados históricos.';
