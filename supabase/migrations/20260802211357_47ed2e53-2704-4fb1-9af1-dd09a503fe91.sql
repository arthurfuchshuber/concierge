-- 1) city_references: escopo de escrita por grupo ou residência, não por nome da cidade
DROP POLICY IF EXISTS "city_references: owners write via group" ON public.city_references;

CREATE POLICY "city_references: owners write via group or property"
ON public.city_references
FOR ALL
TO authenticated
USING (
  (group_id IS NOT NULL AND public.user_is_group_member(auth.uid(), group_id))
  OR (property_id IS NOT NULL AND public.user_can_access_property(auth.uid(), property_id))
)
WITH CHECK (
  (group_id IS NOT NULL AND public.user_is_group_member(auth.uid(), group_id))
  OR (property_id IS NOT NULL AND public.user_can_access_property(auth.uid(), property_id))
);

-- 2) app_user_connections: política explícita, escopada ao próprio usuário
DROP POLICY IF EXISTS "app_user_connections own rows" ON public.app_user_connections;

CREATE POLICY "app_user_connections own rows"
ON public.app_user_connections
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT ALL ON public.app_user_connections TO service_role;

-- 3) property_is_published: execução mínima necessária
REVOKE EXECUTE ON FUNCTION public.property_is_published(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.property_is_published(uuid) TO anon, authenticated, service_role;