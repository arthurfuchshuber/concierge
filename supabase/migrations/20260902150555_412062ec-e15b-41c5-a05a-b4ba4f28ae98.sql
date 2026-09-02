CREATE OR REPLACE FUNCTION public.can_join_presence_topic(_topic text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _kind text;
  _id text;
  _uid uuid := auth.uid();
  _entity uuid;
BEGIN
  IF _uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;
  IF _topic NOT LIKE 'presence:%' THEN RETURN false; END IF;

  _kind := split_part(substring(_topic from 10), ':', 1);
  _id   := split_part(substring(_topic from 10), ':', 2);

  IF public.has_role(_uid, 'admin'::app_role) THEN RETURN true; END IF;

  BEGIN
    _entity := _id::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  IF _kind = 'property' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = _entity
        AND (p.owner_id = _uid OR public.member_can_see_property(_uid, p.owner_id, p.id))
    );
  ELSIF _kind = 'stakeholder' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.property_owners o
      WHERE o.id = _entity AND public.can_access_stakeholder_data(_uid, o.account_owner_id)
    ) OR EXISTS (
      SELECT 1 FROM public.service_providers s
      WHERE s.id = _entity AND public.can_access_stakeholder_data(_uid, s.account_owner_id)
    );
  END IF;

  -- Catálogos globais ('poi-category', 'poi-tag', 'insight', 'ia-knowledge')
  -- são editados apenas pela equipe interna: já liberados acima pelo has_role
  -- admin. Qualquer outro usuário autenticado não entra nesses canais.
  RETURN false;
END;
$function$;