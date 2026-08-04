CREATE TABLE IF NOT EXISTS public.property_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  old_slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_slug_history_property_idx ON public.property_slug_history(property_id);

GRANT SELECT ON public.property_slug_history TO anon;
GRANT SELECT ON public.property_slug_history TO authenticated;
GRANT ALL ON public.property_slug_history TO service_role;

ALTER TABLE public.property_slug_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Slug history is publicly readable"
  ON public.property_slug_history FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.record_property_slug_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL THEN
    DELETE FROM public.property_slug_history WHERE old_slug = NEW.slug;
    INSERT INTO public.property_slug_history (property_id, old_slug)
    VALUES (NEW.id, OLD.slug)
    ON CONFLICT (old_slug) DO UPDATE SET property_id = EXCLUDED.property_id, created_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_slug_history ON public.properties;
CREATE TRIGGER properties_slug_history
  AFTER UPDATE OF slug ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.record_property_slug_change();