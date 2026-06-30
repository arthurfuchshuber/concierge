DROP POLICY IF EXISTS "Anon can delete own reactions" ON public.poi_engagement_events;
REVOKE DELETE ON public.poi_engagement_events FROM anon, authenticated;