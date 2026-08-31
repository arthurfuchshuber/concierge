-- 1) Align user_can_access_property with member_can_see_property:
--    account members only reach a property they were explicitly assigned to.
CREATE OR REPLACE FUNCTION public.user_can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = _property_id
      AND (
        p.owner_id = _user_id
        OR public.member_can_see_property(_user_id, p.owner_id, p.id)
      )
  );
$function$;

-- 2) Stakeholder PII: require an explicit permission, not blanket membership.
CREATE OR REPLACE FUNCTION public.can_access_stakeholder_data(_user_id uuid, _owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _user_id = _owner_id
     OR public.account_member_role_of(_user_id, _owner_id) = 'owner'
     OR public.has_member_permission(_user_id, _owner_id, 'clients_manage')
     OR public.has_member_permission(_user_id, _owner_id, 'operation_edit');
$function$;

DROP POLICY IF EXISTS "Account can manage owners" ON public.property_owners;
CREATE POLICY "Account can manage owners" ON public.property_owners
  FOR ALL TO authenticated
  USING (public.can_access_stakeholder_data(auth.uid(), account_owner_id))
  WITH CHECK (public.can_access_stakeholder_data(auth.uid(), account_owner_id));

DROP POLICY IF EXISTS "Account can manage providers" ON public.service_providers;
CREATE POLICY "Account can manage providers" ON public.service_providers
  FOR ALL TO authenticated
  USING (public.can_access_stakeholder_data(auth.uid(), account_owner_id))
  WITH CHECK (public.can_access_stakeholder_data(auth.uid(), account_owner_id));

DROP POLICY IF EXISTS "Account can manage activities" ON public.stakeholder_activities;
CREATE POLICY "Account can manage activities" ON public.stakeholder_activities
  FOR ALL TO authenticated
  USING (public.can_access_stakeholder_data(auth.uid(), account_owner_id))
  WITH CHECK (public.can_access_stakeholder_data(auth.uid(), account_owner_id));

DROP POLICY IF EXISTS "Account can manage events" ON public.stakeholder_events;
CREATE POLICY "Account can manage events" ON public.stakeholder_events
  FOR ALL TO authenticated
  USING (public.can_access_stakeholder_data(auth.uid(), account_owner_id))
  WITH CHECK (public.can_access_stakeholder_data(auth.uid(), account_owner_id));