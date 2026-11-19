CREATE OR REPLACE FUNCTION public.is_account_member(_user_id uuid, _owner_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (public._may_inspect_user(_user_id) OR auth.uid() = _owner_id) AND EXISTS (
    SELECT 1 FROM public.account_members
    WHERE member_user_id = _user_id AND owner_id = _owner_id AND status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.member_sees_all_properties(_user_id uuid, _owner_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (public._may_inspect_user(_user_id) OR auth.uid() = _owner_id) AND (_user_id = _owner_id OR EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.member_user_id = _user_id AND am.owner_id = _owner_id
      AND am.status = 'active' AND am.all_properties IS TRUE));
$function$;