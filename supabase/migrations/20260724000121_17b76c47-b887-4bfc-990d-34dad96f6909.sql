
-- 1) Revoke PUBLIC/anon EXECUTE on SECURITY DEFINER functions; grant to authenticated only
REVOKE EXECUTE ON FUNCTION public.accept_my_account_invite(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decline_my_account_invite(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_member_permission(uuid, uuid, public.member_permission) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_account_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_my_account_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_member_permission(uuid, uuid, public.member_permission) TO authenticated;

-- 2) Tighten INSERT policy on city_reference_group_members: require caller to be
-- the group's creator, already a member of the group, or an admin -- in addition
-- to owning the property being linked.
DROP POLICY IF EXISTS "members: owner of property can add" ON public.city_reference_group_members;

CREATE POLICY "members: authorized owner can add"
ON public.city_reference_group_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = city_reference_group_members.property_id
      AND p.owner_id = auth.uid()
  )
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.city_reference_groups g
      WHERE g.id = city_reference_group_members.group_id
        AND g.created_by = auth.uid()
    )
    OR public.user_is_group_member(auth.uid(), group_id)
  )
);
