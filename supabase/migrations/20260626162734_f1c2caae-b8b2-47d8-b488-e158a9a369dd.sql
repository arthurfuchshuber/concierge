
-- Grupos de vínculo entre guias para compartilhar Referências na Cidade
CREATE TABLE public.city_reference_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city_key text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX city_reference_groups_city_key_idx ON public.city_reference_groups(city_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_reference_groups TO authenticated;
GRANT ALL ON public.city_reference_groups TO service_role;

ALTER TABLE public.city_reference_groups ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER city_reference_groups_touch_updated_at
  BEFORE UPDATE ON public.city_reference_groups
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Membros (properties) de cada grupo. Uma property pertence no máximo a 1 grupo.
CREATE TABLE public.city_reference_group_members (
  group_id uuid NOT NULL REFERENCES public.city_reference_groups(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, property_id)
);

CREATE INDEX city_reference_group_members_group_idx ON public.city_reference_group_members(group_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_reference_group_members TO authenticated;
GRANT ALL ON public.city_reference_group_members TO service_role;

ALTER TABLE public.city_reference_group_members ENABLE ROW LEVEL SECURITY;

-- city_references ganha vinculação opcional a um grupo
ALTER TABLE public.city_references ADD COLUMN group_id uuid REFERENCES public.city_reference_groups(id) ON DELETE SET NULL;
CREATE INDEX city_references_group_idx ON public.city_references(group_id) WHERE group_id IS NOT NULL;

-- Helper SECURITY DEFINER: usuário é membro de algum grupo?
CREATE OR REPLACE FUNCTION public.user_is_group_member(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.city_reference_group_members m
    JOIN public.properties p ON p.id = m.property_id
    WHERE m.group_id = _group_id AND p.owner_id = _user_id
  );
$$;

-- Helper: usuário possui alguma property nessa cidade (city_key)?
CREATE OR REPLACE FUNCTION public.user_owns_property_in_city(_user_id uuid, _city_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.owner_id = _user_id
      AND lower(regexp_replace(coalesce(p.city, ''), '\s+', '-', 'g')) = _city_key
  );
$$;

-- Policies para city_reference_groups
CREATE POLICY "groups: members read" ON public.city_reference_groups
  FOR SELECT TO authenticated
  USING (public.user_is_group_member(auth.uid(), id) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "groups: any authenticated can create" ON public.city_reference_groups
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "groups: members update" ON public.city_reference_groups
  FOR UPDATE TO authenticated
  USING (public.user_is_group_member(auth.uid(), id) OR has_role(auth.uid(), 'admin'))
  WITH CHECK (public.user_is_group_member(auth.uid(), id) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "groups: members delete" ON public.city_reference_groups
  FOR DELETE TO authenticated
  USING (public.user_is_group_member(auth.uid(), id) OR has_role(auth.uid(), 'admin'));

-- Policies para city_reference_group_members
CREATE POLICY "members: visible to group members" ON public.city_reference_group_members
  FOR SELECT TO authenticated
  USING (public.user_is_group_member(auth.uid(), group_id) OR has_role(auth.uid(), 'admin'));

CREATE POLICY "members: owner of property can add" ON public.city_reference_group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid())
    OR has_role(auth.uid(), 'admin')
  );

CREATE POLICY "members: group members can remove" ON public.city_reference_group_members
  FOR DELETE TO authenticated
  USING (
    public.user_is_group_member(auth.uid(), group_id)
    OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid())
    OR has_role(auth.uid(), 'admin')
  );

-- Expandir policies de city_references para permitir que owners
-- gerenciem (não apenas admin). Mantém policies antigas e adiciona owner-scoped.
CREATE POLICY "city_references: owners write via group" ON public.city_references
  FOR ALL TO authenticated
  USING (
    (group_id IS NOT NULL AND public.user_is_group_member(auth.uid(), group_id))
    OR (group_id IS NULL AND public.user_owns_property_in_city(auth.uid(), city_key))
  )
  WITH CHECK (
    (group_id IS NOT NULL AND public.user_is_group_member(auth.uid(), group_id))
    OR (group_id IS NULL AND public.user_owns_property_in_city(auth.uid(), city_key))
  );

-- Ativar realtime para os grupos
ALTER PUBLICATION supabase_realtime ADD TABLE public.city_reference_groups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.city_reference_group_members;
