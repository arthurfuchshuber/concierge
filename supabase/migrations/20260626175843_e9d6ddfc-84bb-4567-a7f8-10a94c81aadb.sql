ALTER TABLE public.city_references
  ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_city_references_property_id
  ON public.city_references(property_id) WHERE property_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_city_references_group_id
  ON public.city_references(group_id) WHERE group_id IS NOT NULL;

-- Esconde registros legados compartilhados por cidade (sem property_id e sem group_id)
-- para que pare imediatamente o vazamento de categorias antigas entre guias.
UPDATE public.city_references
  SET is_hidden = true
  WHERE property_id IS NULL AND group_id IS NULL AND is_hidden = false;