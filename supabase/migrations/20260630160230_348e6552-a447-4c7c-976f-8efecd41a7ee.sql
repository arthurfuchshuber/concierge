REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;

DROP POLICY IF EXISTS "sigma_packs_public_read_published" ON public.sigma_city_packs;
CREATE POLICY "sigma_packs_public_read_published"
ON public.sigma_city_packs
FOR SELECT
TO anon, authenticated
USING (is_published = true);

DROP POLICY IF EXISTS "sigma_faqs_public_read_published" ON public.sigma_city_faqs;
CREATE POLICY "sigma_faqs_public_read_published"
ON public.sigma_city_faqs
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sigma_city_packs p
    WHERE p.city_key = sigma_city_faqs.city_key
      AND p.is_published = true
  )
);

DROP POLICY IF EXISTS "sigma_mkt_public_read_published" ON public.sigma_city_marketplace;
CREATE POLICY "sigma_mkt_public_read_published"
ON public.sigma_city_marketplace
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sigma_city_packs p
    WHERE p.city_key = sigma_city_marketplace.city_key
      AND p.is_published = true
  )
);

DROP POLICY IF EXISTS "sigma_recs_public_read_published" ON public.sigma_city_recommendations;
CREATE POLICY "sigma_recs_public_read_published"
ON public.sigma_city_recommendations
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.sigma_city_packs p
    WHERE p.city_key = sigma_city_recommendations.city_key
      AND p.is_published = true
  )
);