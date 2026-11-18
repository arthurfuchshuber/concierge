CREATE OR REPLACE FUNCTION public._may_inspect_user(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN coalesce(auth.role(), '') NOT IN ('anon', 'authenticated')
    WHEN _user_id = auth.uid() THEN true
    ELSE public.has_role(auth.uid(), 'admin'::public.app_role)
  END
$$;
REVOKE EXECUTE ON FUNCTION public._may_inspect_user(uuid) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.decline_my_account_invite(_invite_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  caller_email text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT lower(u.email) INTO caller_email FROM auth.users u
   WHERE u.id = caller_id AND u.email_confirmed_at IS NOT NULL;
  IF caller_email IS NULL OR caller_email = '' THEN
    RAISE EXCEPTION 'E-mail não confirmado' USING ERRCODE = '28000';
  END IF;
  UPDATE public.account_member_invites
     SET status = 'declined', updated_at = now()
   WHERE id = _invite_id AND status = 'pending' AND lower(email) = caller_email;
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.account_member_role_of(_user_id uuid, _owner_id uuid)
 RETURNS account_member_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT role FROM public.account_members
  WHERE member_user_id = _user_id AND owner_id = _owner_id AND status = 'active'
    AND (public._may_inspect_user(_user_id) OR _owner_id = auth.uid())
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.has_active_subscription(user_uuid uuid, check_env text DEFAULT 'live'::text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select public._may_inspect_user(user_uuid) and exists (
    select 1 from public.subscriptions
    where user_id = user_uuid and environment = check_env
      and ((status in ('active','trialing') and (current_period_end is null or current_period_end > now()))
        or (status = 'canceled' and current_period_end > now()))
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_member_permission(_user_id uuid, _owner_id uuid, _permission member_permission)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.account_member_permissions%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _owner_id IS NULL THEN RETURN false; END IF;
  IF NOT (public._may_inspect_user(_user_id) OR _owner_id = auth.uid()) THEN RETURN false; END IF;
  IF _user_id = _owner_id THEN RETURN true; END IF;
  IF NOT public.is_account_member(_user_id, _owner_id) THEN RETURN false; END IF;
  SELECT * INTO v_row FROM public.account_member_permissions
    WHERE owner_id = _owner_id AND member_user_id = _user_id AND permission = _permission;
  IF FOUND THEN RETURN COALESCE(v_row.granted, false); END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.member_can_see_property(_user_id uuid, _owner_id uuid, _property_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (public._may_inspect_user(_user_id) OR _owner_id = auth.uid())
    AND public.is_account_member(_user_id, _owner_id)
    AND (
      EXISTS (SELECT 1 FROM public.account_members am
        WHERE am.member_user_id = _user_id AND am.owner_id = _owner_id
          AND am.status = 'active' AND am.all_properties IS TRUE)
      OR EXISTS (SELECT 1 FROM public.property_assignments pa
        WHERE pa.user_id = _user_id AND pa.property_id = _property_id
          AND COALESCE(pa.status, 'active') = 'active')
    );
$function$;

CREATE OR REPLACE FUNCTION public.user_owns_property_in_city(_user_id uuid, _city_key text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
  SELECT public._may_inspect_user(_user_id) AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.owner_id = _user_id
      AND lower(regexp_replace(coalesce(p.city, ''), '\s+', '-', 'g')) = _city_key
  );
$function$;