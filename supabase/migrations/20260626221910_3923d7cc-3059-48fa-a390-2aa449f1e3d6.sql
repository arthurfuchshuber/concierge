-- Finding: guide_access_logs_no_insert_policy
-- Make it explicit that anon/authenticated cannot insert into guide_access_logs.
-- Only the service role (used by trusted server functions) may write.
REVOKE INSERT, UPDATE, DELETE ON public.guide_access_logs FROM anon, authenticated;

-- Add a restrictive INSERT policy so even if a future migration grants INSERT,
-- the row will still be rejected for non-service roles by default.
DROP POLICY IF EXISTS "guide_access_logs deny client inserts" ON public.guide_access_logs;
CREATE POLICY "guide_access_logs deny client inserts"
  ON public.guide_access_logs
  AS RESTRICTIVE
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (false);

-- Finding: city_references_property_id_exposure
-- Stop leaking the internal property_id UUID through the public/anon read surface.
-- Authenticated owners/group members still need it (RLS policies join on it),
-- so we only revoke the column from anon.
REVOKE SELECT (property_id) ON public.city_references FROM anon;