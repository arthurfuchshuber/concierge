DROP POLICY IF EXISTS "host_behavior public read enabled" ON public.host_behavior;
REVOKE SELECT ON public.host_behavior FROM anon;