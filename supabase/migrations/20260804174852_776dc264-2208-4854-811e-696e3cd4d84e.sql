-- 1) Restrict property_slug_history reads to owners/account members
DROP POLICY IF EXISTS "Slug history is publicly readable" ON public.property_slug_history;

REVOKE ALL ON public.property_slug_history FROM anon;
GRANT SELECT ON public.property_slug_history TO authenticated;
GRANT ALL ON public.property_slug_history TO service_role;

CREATE POLICY "Owners and members can read slug history"
ON public.property_slug_history
FOR SELECT
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id));

-- 2) Trigger-only SECURITY DEFINER function must not be callable via the API
REVOKE ALL ON FUNCTION public.record_property_slug_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_property_slug_change() FROM anon;
REVOKE ALL ON FUNCTION public.record_property_slug_change() FROM authenticated;