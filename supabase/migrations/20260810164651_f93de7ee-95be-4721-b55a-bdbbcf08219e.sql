CREATE OR REPLACE FUNCTION public.current_verified_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT lower(u.email)
  FROM auth.users u
  WHERE u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.current_verified_email() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_verified_email() TO authenticated;

DROP POLICY IF EXISTS "Invitee can view own invite" ON public.account_member_invites;
CREATE POLICY "Invitee can view own invite"
  ON public.account_member_invites FOR SELECT
  TO authenticated
  USING (
    status = 'pending'
    AND lower(email) = public.current_verified_email()
  );