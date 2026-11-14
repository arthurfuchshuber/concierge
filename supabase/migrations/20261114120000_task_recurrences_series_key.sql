-- Registro que nunca se perde (14/11/2026).
-- A série do "Repetir" agora vai dentro do trabalho guardado no aparelho e é enviada pela fila,
-- com retentativas. Para repetir o envio nunca duplicar a série, cada série nasce no aparelho com
-- uma chave (`series_key`) e o servidor ignora a repetição da mesma chave para o mesmo imóvel.
--
-- Índice ÚNICO NÃO parcial de propósito: o upsert do PostgREST (`on_conflict=series_key,property_id`)
-- só infere índices sem condição. Linhas antigas (series_key NULL) não colidem entre si, porque em
-- índice único o NULL é sempre distinto.

ALTER TABLE public.task_recurrences
  ADD COLUMN IF NOT EXISTS series_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS task_recurrences_series_key_property_uq
  ON public.task_recurrences (series_key, property_id);
