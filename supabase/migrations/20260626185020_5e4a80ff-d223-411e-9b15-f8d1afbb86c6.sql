-- Substitui a unique global por uniques por escopo (group/property/legado).
DROP INDEX IF EXISTS public.city_references_unique_place;

-- Mesmo grupo + mesmo place_id: único.
CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_group_place
  ON public.city_references (group_id, place_id)
  WHERE group_id IS NOT NULL AND place_id IS NOT NULL;

-- Mesmo imóvel (sem grupo) + mesmo place_id: único.
CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_property_place
  ON public.city_references (property_id, place_id)
  WHERE property_id IS NOT NULL AND group_id IS NULL AND place_id IS NOT NULL;

-- Modo legado (sem property/group): único por cidade.
CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_legacy_place
  ON public.city_references (city_key, COALESCE(state, ''::text), country, place_id)
  WHERE property_id IS NULL AND group_id IS NULL AND place_id IS NOT NULL;

-- Fallback de nome para registros sem place_id (raro).
CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_group_name
  ON public.city_references (group_id, lower(name))
  WHERE group_id IS NOT NULL AND place_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_property_name
  ON public.city_references (property_id, lower(name))
  WHERE property_id IS NOT NULL AND group_id IS NULL AND place_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_legacy_name
  ON public.city_references (city_key, COALESCE(state, ''::text), country, lower(name))
  WHERE property_id IS NULL AND group_id IS NULL AND place_id IS NULL;