CREATE OR REPLACE FUNCTION public.member_can_see_property(_user_id uuid, _owner_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_member(_user_id, _owner_id)
     AND EXISTS (
       SELECT 1 FROM public.property_assignments pa
       WHERE pa.user_id = _user_id
         AND pa.property_id = _property_id
         AND COALESCE(pa.status, 'active') = 'active'
     );
$$;

REVOKE ALL ON FUNCTION public.member_can_see_property(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_can_see_property(uuid, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "properties member read" ON public.properties;
CREATE POLICY "properties member read"
ON public.properties FOR SELECT
TO authenticated
USING (public.member_can_see_property(auth.uid(), owner_id, id));