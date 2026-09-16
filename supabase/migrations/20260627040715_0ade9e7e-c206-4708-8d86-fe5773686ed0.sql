
REVOKE ALL ON public.city_references FROM anon;
GRANT SELECT (
  id, city_key, city_label, state, country, category, type, place_id, name, note,
  address, rating, user_ratings_total, primary_type, lat, lng, image_url, maps_url,
  opening_hours, source, is_hidden, display_order, last_synced_at, created_at,
  updated_at, group_id
) ON public.city_references TO anon;

REVOKE ALL ON public.city_references FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_references TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.guide_access_logs FROM anon, authenticated;
