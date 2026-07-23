-- Require explicit invite acceptance: neutralize the auto-accept trigger fn.
-- The trigger stays attached to auth.users (owned by our schema) but does
-- nothing; invites remain 'pending' and are accepted via UI popup.
CREATE OR REPLACE FUNCTION public.accept_account_invite_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- No-op: acceptance now requires explicit user action via PendingInviteDialog.
  RETURN NEW;
END;
$$;

-- Server-callable acceptance: security-definer bypasses RLS to insert into
-- account_members and mark the invite accepted, only when the caller's email
-- matches the invite. Used by the pending-invite popup.
CREATE OR REPLACE FUNCTION public.accept_my_account_invite(_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv RECORD;
  caller_email text := lower(coalesce(auth.jwt()->>'email',''));
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO inv FROM public.account_member_invites
   WHERE id = _invite_id
     AND status = 'pending'
     AND lower(email) = caller_email
     AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado ou expirado' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.account_members (owner_id, member_user_id, role, status, invited_by)
  VALUES (inv.owner_id, caller_id, inv.role, 'active'::public.account_member_status, inv.invited_by)
  ON CONFLICT (owner_id, member_user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active'::public.account_member_status, updated_at = now();

  UPDATE public.account_member_invites
     SET status = 'accepted', accepted_user_id = caller_id, accepted_at = now(), updated_at = now()
   WHERE id = inv.id;

  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (caller_id, caller_email, 'account_invite.accepted', 'account_member_invites', inv.id::text,
    jsonb_build_object('owner_id', inv.owner_id, 'role', inv.role, 'via', 'popup'));
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_my_account_invite(_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_email text := lower(coalesce(auth.jwt()->>'email',''));
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  UPDATE public.account_member_invites
     SET status = 'declined', updated_at = now()
   WHERE id = _invite_id
     AND status = 'pending'
     AND lower(email) = caller_email;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_my_account_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_my_account_invite(uuid) TO authenticated;