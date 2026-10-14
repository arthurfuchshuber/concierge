CREATE OR REPLACE FUNCTION public.accept_my_account_invite(_invite_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  inv RECORD;
  caller_id uuid := auth.uid();
  caller_email text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Usa o e-mail CONFIRMADO do cadastro, nunca só o claim do token.
  SELECT lower(u.email) INTO caller_email
    FROM auth.users u
   WHERE u.id = caller_id AND u.email_confirmed_at IS NOT NULL;
  IF caller_email IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'E-mail não confirmado' USING ERRCODE = '28000';
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
REVOKE EXECUTE ON FUNCTION public.accept_my_account_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_my_account_invite(uuid) TO authenticated;