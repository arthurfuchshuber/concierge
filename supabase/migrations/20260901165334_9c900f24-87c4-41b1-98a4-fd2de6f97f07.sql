DROP POLICY IF EXISTS "city_references public read visible" ON public.city_references;

CREATE POLICY "city_references public read visible"
ON public.city_references
FOR SELECT
TO anon, authenticated
USING (
  is_hidden = false
  AND (property_id IS NULL OR public.property_is_published(property_id))
);