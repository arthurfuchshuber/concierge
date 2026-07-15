-- Revoke public/anon EXECUTE on SECURITY DEFINER helpers. Triggers ignore EXECUTE
-- privileges, and RLS helper functions only need to be callable by authenticated users.

REVOKE EXECUTE ON FUNCTION public.accept_account_invite_on_signup() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_conversation_last_message() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.account_member_role_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_account_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_property(uuid, uuid) FROM PUBLIC, anon;