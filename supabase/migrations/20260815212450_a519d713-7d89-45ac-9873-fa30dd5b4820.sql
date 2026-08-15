CREATE OR REPLACE FUNCTION public.has_member_permission(_user_id uuid, _owner_id uuid, _permission member_permission)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.account_member_permissions%ROWTYPE;
  v_default boolean;
BEGIN
  IF _user_id IS NULL OR _owner_id IS NULL THEN RETURN false; END IF;
  IF _user_id = _owner_id THEN RETURN true; END IF;
  IF NOT public.is_account_member(_user_id, _owner_id) THEN RETURN false; END IF;

  SELECT * INTO v_row FROM public.account_member_permissions
    WHERE owner_id = _owner_id AND member_user_id = _user_id AND permission = _permission;

  IF FOUND THEN RETURN COALESCE(v_row.granted, false); END IF;

  v_default := CASE _permission
    WHEN 'library_view'    THEN true
    WHEN 'ai_view'         THEN true
    WHEN 'chat_view'       THEN true
    WHEN 'operation_view'  THEN true
    WHEN 'guests_view'     THEN true
    ELSE false
  END;
  RETURN COALESCE(v_default, false);
END;
$function$;