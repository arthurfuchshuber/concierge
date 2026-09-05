CREATE OR REPLACE FUNCTION public.member_can_see_property(_user_id uuid, _owner_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_account_member(_user_id, _owner_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.account_members am
        WHERE am.member_user_id = _user_id
          AND am.owner_id = _owner_id
          AND am.status = 'active'
          AND am.all_properties IS TRUE
      )
      OR EXISTS (
        SELECT 1 FROM public.property_assignments pa
        WHERE pa.user_id = _user_id
          AND pa.property_id = _property_id
          AND COALESCE(pa.status, 'active') = 'active'
      )
    );
$$;