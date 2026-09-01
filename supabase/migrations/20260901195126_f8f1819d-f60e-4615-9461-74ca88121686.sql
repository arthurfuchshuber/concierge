-- 1) Internal admin notes on city packs must not be readable by the public (anon) role.
REVOKE SELECT ON public.sigma_city_packs FROM anon;
GRANT SELECT (id, city_key, city_label, country, cover_url, is_published, created_at, updated_at)
  ON public.sigma_city_packs TO anon;

-- 2) Basic abuse guard for anonymous engagement events.
CREATE INDEX IF NOT EXISTS poi_engagement_events_anon_recent_idx
  ON public.poi_engagement_events (anon_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_poi_engagement_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent_count integer;
BEGIN
  SELECT count(*) INTO recent_count
  FROM public.poi_engagement_events e
  WHERE e.anon_id = NEW.anon_id
    AND e.created_at > now() - interval '1 hour';

  IF recent_count >= 300 THEN
    RAISE EXCEPTION 'Rate limit exceeded for engagement events';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS poi_engagement_events_rate_limit ON public.poi_engagement_events;
CREATE TRIGGER poi_engagement_events_rate_limit
  BEFORE INSERT ON public.poi_engagement_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_poi_engagement_rate_limit();