DROP POLICY IF EXISTS "public read daily tips" ON public.property_daily_tips;
REVOKE SELECT ON public.property_daily_tips FROM anon;