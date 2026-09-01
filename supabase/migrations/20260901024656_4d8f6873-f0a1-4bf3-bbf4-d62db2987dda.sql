-- 1) Função SECURITY DEFINER não pode ser executável por visitantes anônimos.
REVOKE EXECUTE ON FUNCTION public.can_access_stakeholder_data(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_stakeholder_data(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_stakeholder_data(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_stakeholder_data(uuid, uuid) TO service_role;

-- 2) Criação de grupos de referência exige contexto real de conta (dono de imóvel ou admin).
DROP POLICY IF EXISTS "groups: any authenticated can create" ON public.city_reference_groups;
CREATE POLICY "groups: account holders can create"
  ON public.city_reference_groups FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (SELECT 1 FROM public.properties p WHERE p.owner_id = auth.uid())
    )
  );

-- 3) Eventos de engajamento só podem apontar para imóveis publicados existentes.
DROP POLICY IF EXISTS "Anyone can insert engagement events" ON public.poi_engagement_events;
CREATE POLICY "Anyone can insert engagement events"
  ON public.poi_engagement_events FOR INSERT TO anon, authenticated
  WITH CHECK (
    char_length(anon_id) >= 8
    AND char_length(anon_id) <= 128
    AND char_length(poi_key) >= 1
    AND char_length(poi_key) <= 512
    AND event_type = ANY (ARRAY['view','share','like','dislike'])
    AND poi_type = ANY (ARRAY['city_reference','recommendation','sigma_city_reference','marketplace_link'])
    AND public.property_is_published(property_id)
  );

-- 4) Canais de presença/broadcast passam a ser privados e escopados por acesso real.
CREATE OR REPLACE FUNCTION public.can_join_presence_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  ELSIF _kind IN ('poi-category', 'poi-tag', 'insight', 'ia-knowledge') THEN
    -- Catálogos globais editados apenas pela equipe interna autenticada.
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.can_join_presence_topic(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_join_presence_topic(text) TO authenticated;

DROP POLICY IF EXISTS "presence: authorized users can read topic" ON realtime.messages;
CREATE POLICY "presence: authorized users can read topic"
  ON realtime.messages FOR SELECT TO authenticated
  USING (public.can_join_presence_topic((SELECT realtime.topic())));

DROP POLICY IF EXISTS "presence: authorized users can write topic" ON realtime.messages;
CREATE POLICY "presence: authorized users can write topic"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (public.can_join_presence_topic((SELECT realtime.topic())));