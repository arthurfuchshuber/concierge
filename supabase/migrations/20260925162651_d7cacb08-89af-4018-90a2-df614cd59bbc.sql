CREATE OR REPLACE FUNCTION public.place_photo_known(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT length(_name) BETWEEN 10 AND 400 AND (
    EXISTS (SELECT 1 FROM public.property_recommendations WHERE position(_name in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.sigma_city_recommendations WHERE position(_name in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.city_references WHERE position(_name in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.properties WHERE position(_name in coalesce(hero_image_url,'')) > 0
               OR position(_name in coalesce(gallery_images::text,'')) > 0
               OR position(_name in coalesce(theme_images::text,'')) > 0)
    OR EXISTS (SELECT 1 FROM public.city_daily_news WHERE position(_name in coalesce(items::text,'')) > 0)
  )
$$;
REVOKE ALL ON FUNCTION public.place_photo_known(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_photo_known(text) TO service_role;