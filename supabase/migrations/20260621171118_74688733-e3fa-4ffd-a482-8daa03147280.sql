-- Remove anonymous INSERT path for guide_access_logs; all inserts go via service-role server function.
DROP POLICY IF EXISTS "Anyone can register guide access" ON public.guide_access_logs;
REVOKE INSERT ON public.guide_access_logs FROM anon, authenticated;