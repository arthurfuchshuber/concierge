GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_member_permission(uuid, uuid, public.member_permission) TO authenticated, service_role;
