DROP POLICY IF EXISTS "Anyone can insert engagement events" ON public.poi_engagement_events;

CREATE POLICY "Anyone can insert engagement events"
ON public.poi_engagement_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(anon_id) BETWEEN 8 AND 128
  AND char_length(poi_key) BETWEEN 1 AND 512
  AND event_type = ANY (ARRAY['view','share','like','dislike'])
  AND poi_type = ANY (ARRAY['city_reference','recommendation','sigma_city_reference','marketplace_link'])
);