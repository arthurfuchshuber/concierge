CREATE OR REPLACE FUNCTION public.place_photo_known(_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH n AS (SELECT _name AS a, replace(_name, '/', '%2F') AS b)
  SELECT length(_name) BETWEEN 10 AND 2000 AND (
    EXISTS (SELECT 1 FROM public.property_recommendations, n WHERE position(n.a in image_url) > 0 OR position(n.b in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.sigma_city_recommendations, n WHERE position(n.a in image_url) > 0 OR position(n.b in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.city_references, n WHERE position(n.a in image_url) > 0 OR position(n.b in image_url) > 0)
    OR EXISTS (SELECT 1 FROM public.properties, n WHERE
               position(n.a in coalesce(hero_image_url,'')) > 0 OR position(n.b in coalesce(hero_image_url,'')) > 0
               OR position(n.a in coalesce(gallery_images::text,'')) > 0 OR position(n.b in coalesce(gallery_images::text,'')) > 0
               OR position(n.a in coalesce(theme_images::text,'')) > 0 OR position(n.b in coalesce(theme_images::text,'')) > 0)
    OR EXISTS (SELECT 1 FROM public.city_daily_news, n WHERE position(n.a in coalesce(items::text,'')) > 0 OR position(n.b in coalesce(items::text,'')) > 0)
  )
$function$;