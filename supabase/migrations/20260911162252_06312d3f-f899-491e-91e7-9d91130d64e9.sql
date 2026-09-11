
DROP POLICY IF EXISTS "Owner manages permissions" ON public.account_member_permissions;
CREATE POLICY "Owner manages permissions"
ON public.account_member_permissions
FOR ALL
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (
  auth.uid() = owner_id
  AND EXISTS (
    SELECT 1 FROM public.account_members m
    WHERE m.owner_id = account_member_permissions.owner_id
      AND m.member_user_id = account_member_permissions.member_user_id
      AND m.status IN ('active','pending')
  )
);

DROP POLICY IF EXISTS "Owners manage permission assignments" ON public.permission_assignments;
CREATE POLICY "Owners manage permission assignments"
ON public.permission_assignments
FOR ALL
TO authenticated
USING (tenant_id = auth.uid())
WITH CHECK (
  tenant_id = auth.uid()
  AND (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.account_members m
      WHERE m.owner_id = permission_assignments.tenant_id
        AND m.member_user_id = permission_assignments.user_id
        AND m.status IN ('active','pending')
    )
  )
);
