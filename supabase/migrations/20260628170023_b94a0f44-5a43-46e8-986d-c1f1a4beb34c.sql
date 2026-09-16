
CREATE TABLE public.poi_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  poi_key text NOT NULL,
  poi_type text NOT NULL CHECK (poi_type IN ('city_reference','recommendation','sigma_city_reference','marketplace_link')),
  event_type text NOT NULL CHECK (event_type IN ('view','share','like','dislike')),
  anon_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX poi_engagement_prop_key_idx ON public.poi_engagement_events (property_id, poi_key);
CREATE INDEX poi_engagement_prop_event_idx ON public.poi_engagement_events (property_id, event_type);
CREATE INDEX poi_engagement_anon_idx ON public.poi_engagement_events (anon_id, poi_key);
-- One "view" per anon per day per POI: server upserts manually via WHERE NOT EXISTS
CREATE UNIQUE INDEX poi_engagement_unique_reaction
  ON public.poi_engagement_events (property_id, poi_key, anon_id, event_type)
  WHERE event_type IN ('like','dislike');

GRANT SELECT, INSERT, DELETE ON public.poi_engagement_events TO anon;
GRANT SELECT, INSERT, DELETE ON public.poi_engagement_events TO authenticated;
GRANT ALL ON public.poi_engagement_events TO service_role;

ALTER TABLE public.poi_engagement_events ENABLE ROW LEVEL SECURITY;

-- Anyone may insert engagement events (anonymous guests).
CREATE POLICY "Anyone can insert engagement events"
  ON public.poi_engagement_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Hosts (owners) and SaaS admins may read engagement events for their properties.
CREATE POLICY "Owners and admins read engagement events"
  ON public.poi_engagement_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = poi_engagement_events.property_id
        AND (p.owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Anon can delete only their own reactions (to support toggle).
CREATE POLICY "Anon can delete own reactions"
  ON public.poi_engagement_events FOR DELETE
  TO anon, authenticated
  USING (event_type IN ('like','dislike'));
