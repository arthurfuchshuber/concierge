-- "Não sincronizar este imóvel": o imóvel sai do aviso obrigatório e do alerta de imóveis sem
-- sincronização (não é arquivado nem apagado). NULL = comportamento normal. Desfazer = voltar a NULL.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS sync_dismissed_at timestamptz;

COMMENT ON COLUMN public.properties.sync_dismissed_at IS
  'Quando a pessoa escolheu NÃO sincronizar este imóvel com o Airbnb. Imóveis com valor aqui não entram em listUnsyncedProperties (aviso obrigatório/alerta).';
