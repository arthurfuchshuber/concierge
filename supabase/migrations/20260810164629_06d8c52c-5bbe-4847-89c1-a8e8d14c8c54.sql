DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Invitee can view own invite" ON public.account_member_invites;
CREATE POLICY "Invitee can view own invite"
  ON public.account_member_invites FOR SELECT
  TO authenticated
  USING (
    status = 'pending'
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    AND COALESCE(auth.jwt() -> 'user_metadata' ->> 'email_verified', 'false')::boolean IS TRUE
  );