REVOKE EXECUTE ON FUNCTION public.can_read_system_doc(text[]) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_system_doc(text[]) TO authenticated, service_role;