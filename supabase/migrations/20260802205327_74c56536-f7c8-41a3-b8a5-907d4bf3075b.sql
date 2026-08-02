-- Security definer helper: confirms the property exists and is publicly published,
-- so anonymous guide visitors cannot attribute engagement to arbitrary property ids.
CREATE OR REPLACE FUNCTION public.property_is_published(_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = _property_id AND p.published = true
  );
$$;

DROP POLICY IF EXISTS "Anyone can insert engagement events" ON public.poi_engagement_events;

CREATE POLICY "Anyone can insert engagement events"
ON public.poi_engagement_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  public.property_is_published(property_id)
  AND char_length(anon_id) >= 8 AND char_length(anon_id) <= 128
  AND char_length(poi_key) >= 1 AND char_length(poi_key) <= 512
  AND event_type = ANY (ARRAY['view','share','like','dislike'])
  AND poi_type = ANY (ARRAY['city_reference','recommendation','sigma_city_reference','marketplace_link'])
);