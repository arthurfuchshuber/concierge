GRANT EXECUTE ON FUNCTION public.user_can_access_property(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_member_role_of(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_is_group_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_owns_property_in_city(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid, text) TO authenticated, service_role;