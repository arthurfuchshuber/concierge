
-- Atualiza defaults da função para refletir novo modelo view/edit
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

  IF FOUND THEN RETURN v_row.granted; END IF;

  v_default := CASE _permission
    WHEN 'library_view'    THEN true
    WHEN 'library_edit'    THEN false
    WHEN 'ai_view'         THEN true
    WHEN 'ai_train'        THEN false
    WHEN 'chat_view'       THEN true
    WHEN 'chat_respond'    THEN false
    WHEN 'operation_view'  THEN true
    WHEN 'operation_edit'  THEN false
    WHEN 'guests_view'     THEN true
    WHEN 'guests_edit'     THEN false
    WHEN 'clients_manage'  THEN false
    WHEN 'trial_manage'    THEN false
    WHEN 'pricing_override' THEN false
  END;
  RETURN v_default;
END;
$function$;

-- Backfill: membros ativos hoje devem manter o acesso que já tinham por default
-- (chat_respond, ai_train, library_edit = true). Grava linha explícita se ainda não existir.
INSERT INTO public.account_member_permissions (owner_id, member_user_id, permission, granted, updated_at)
SELECT am.owner_id, am.member_user_id, p.perm, true, now()
FROM public.account_members am
CROSS JOIN (VALUES
  ('chat_respond'::public.member_permission),
  ('ai_train'::public.member_permission),
  ('library_edit'::public.member_permission)
) AS p(perm)
WHERE am.status = 'active'
ON CONFLICT (owner_id, member_user_id, permission) DO NOTHING;
