CREATE OR REPLACE FUNCTION public.enforce_published_property_engagement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = NEW.property_id AND p.published = true
  ) THEN
    RAISE EXCEPTION 'Property is not published' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_published_property_engagement ON public.poi_engagement_events;
CREATE TRIGGER enforce_published_property_engagement
BEFORE INSERT ON public.poi_engagement_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_published_property_engagement();

DROP POLICY IF EXISTS "Anyone can insert engagement events" ON public.poi_engagement_events;
CREATE POLICY "Anyone can insert engagement events"
ON public.poi_engagement_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(anon_id) >= 8 AND char_length(anon_id) <= 128
  AND char_length(poi_key) >= 1 AND char_length(poi_key) <= 512
  AND event_type = ANY (ARRAY['view','share','like','dislike'])
  AND poi_type = ANY (ARRAY['city_reference','recommendation','sigma_city_reference','marketplace_link'])
);

REVOKE EXECUTE ON FUNCTION public.property_is_published(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_published_property_engagement() FROM PUBLIC, anon, authenticated;