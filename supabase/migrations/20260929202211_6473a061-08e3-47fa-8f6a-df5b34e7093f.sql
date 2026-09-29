
CREATE OR REPLACE FUNCTION public.member_sees_all_properties(_user_id uuid, _owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id = _owner_id OR EXISTS (
    SELECT 1 FROM public.account_members am
    WHERE am.member_user_id = _user_id AND am.owner_id = _owner_id
      AND am.status = 'active' AND am.all_properties IS TRUE);
$$;
REVOKE EXECUTE ON FUNCTION public.member_sees_all_properties(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_sees_all_properties(uuid, uuid) TO authenticated;

-- Tarefas: membro com recorte só vê tarefas dos imóveis dele
DROP POLICY IF EXISTS "Account can manage tasks" ON public.tasks;
CREATE POLICY "Account can manage tasks" ON public.tasks FOR ALL TO authenticated
USING (auth.uid() = account_owner_id OR (public.is_account_member(auth.uid(), account_owner_id) AND (
  (property_id IS NOT NULL AND public.user_can_access_property(auth.uid(), property_id))
  OR (property_id IS NULL AND public.member_sees_all_properties(auth.uid(), account_owner_id)))))
WITH CHECK (auth.uid() = account_owner_id OR (public.is_account_member(auth.uid(), account_owner_id) AND (
  (property_id IS NOT NULL AND public.user_can_access_property(auth.uid(), property_id))
  OR (property_id IS NULL AND public.member_sees_all_properties(auth.uid(), account_owner_id)))));

-- Vínculos imóvel ↔ prestador: só dos imóveis visíveis
DROP POLICY IF EXISTS "Account can manage property providers" ON public.property_providers;
CREATE POLICY "Account can manage property providers" ON public.property_providers FOR ALL TO authenticated
USING (account_owner_id = auth.uid() OR (public.is_account_member(auth.uid(), account_owner_id) AND public.user_can_access_property(auth.uid(), property_id)))
WITH CHECK (account_owner_id = auth.uid() OR (public.is_account_member(auth.uid(), account_owner_id) AND public.user_can_access_property(auth.uid(), property_id)));

-- Prestadores: membro com recorte só vê a si mesmo e quem atende os imóveis dele
DROP POLICY IF EXISTS "Scoped members see related providers" ON public.service_providers;
CREATE POLICY "Scoped members see related providers" ON public.service_providers AS RESTRICTIVE FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.member_sees_all_properties(auth.uid(), account_owner_id)
  OR member_user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.property_providers pp WHERE pp.provider_id = service_providers.id AND public.user_can_access_property(auth.uid(), pp.property_id)));

-- Proprietários: membro com recorte só vê donos dos imóveis dele
DROP POLICY IF EXISTS "Scoped members see related owners" ON public.property_owners;
CREATE POLICY "Scoped members see related owners" ON public.property_owners AS RESTRICTIVE FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.member_sees_all_properties(auth.uid(), account_owner_id)
  OR EXISTS (SELECT 1 FROM public.properties p WHERE p.owner_contact_id = property_owners.id AND public.user_can_access_property(auth.uid(), p.id)));
