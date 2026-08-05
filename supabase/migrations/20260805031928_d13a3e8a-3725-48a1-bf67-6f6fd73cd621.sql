CREATE OR REPLACE FUNCTION public.can_read_permission_catalog(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.member_user_id = _user_id AND am.status = 'active'::account_member_status
    )
    OR EXISTS (
      SELECT 1 FROM public.account_members am WHERE am.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.properties p WHERE p.owner_id = _user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.subscriptions s WHERE s.user_id = _user_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_read_permission_catalog(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_permission_catalog(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admins and account owners read permission nodes" ON public.permission_nodes;

CREATE POLICY "Permission catalog readable by account context"
ON public.permission_nodes
FOR SELECT
TO authenticated
USING (public.can_read_permission_catalog(auth.uid()));