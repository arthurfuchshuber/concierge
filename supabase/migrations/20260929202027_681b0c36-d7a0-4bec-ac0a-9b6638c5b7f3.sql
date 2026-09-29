
CREATE OR REPLACE FUNCTION public.sync_stakeholder_member_scope(_owner_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _email text;
  _is_stakeholder boolean;
BEGIN
  IF _owner_id IS NULL OR _user_id IS NULL OR _owner_id = _user_id THEN RETURN; END IF;
  SELECT lower(email) INTO _email FROM auth.users WHERE id = _user_id;

  -- vincula o cadastro do prestador/proprietário ao login (mesma conta, mesmo e-mail)
  IF _email IS NOT NULL THEN
    UPDATE public.service_providers SET member_user_id = _user_id
      WHERE account_owner_id = _owner_id AND member_user_id IS NULL AND lower(email) = _email;
  END IF;

  _is_stakeholder := EXISTS (SELECT 1 FROM public.service_providers WHERE account_owner_id=_owner_id AND member_user_id=_user_id)
                  OR EXISTS (SELECT 1 FROM public.property_owners WHERE account_owner_id=_owner_id AND lower(email)=_email);
  IF NOT _is_stakeholder THEN RETURN; END IF;

  -- prestador/proprietário nunca vê a conta inteira: só os imóveis vinculados a ele
  UPDATE public.account_members SET all_properties = false, updated_at = now()
    WHERE owner_id = _owner_id AND member_user_id = _user_id AND all_properties IS DISTINCT FROM false;

  WITH allowed AS (
    SELECT pp.property_id FROM public.property_providers pp
      JOIN public.service_providers sp ON sp.id = pp.provider_id
      WHERE sp.account_owner_id = _owner_id AND sp.member_user_id = _user_id
    UNION
    SELECT p.id FROM public.properties p
      JOIN public.property_owners po ON po.id = p.owner_contact_id
      WHERE p.owner_id = _owner_id AND lower(po.email) = _email
  )
  DELETE FROM public.property_assignments pa
    WHERE pa.tenant_id = _owner_id AND pa.user_id = _user_id
      AND pa.property_id NOT IN (SELECT property_id FROM allowed);

  INSERT INTO public.property_assignments (tenant_id, property_id, user_id, status)
  SELECT _owner_id, a.property_id, _user_id, 'active' FROM (
    SELECT pp.property_id FROM public.property_providers pp
      JOIN public.service_providers sp ON sp.id = pp.provider_id
      WHERE sp.account_owner_id = _owner_id AND sp.member_user_id = _user_id
    UNION
    SELECT p.id FROM public.properties p
      JOIN public.property_owners po ON po.id = p.owner_contact_id
      WHERE p.owner_id = _owner_id AND lower(po.email) = _email
  ) a
  ON CONFLICT (tenant_id, property_id, user_id) DO UPDATE SET status = 'active';
END $$;
REVOKE EXECUTE ON FUNCTION public.sync_stakeholder_member_scope(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_stakeholder_scope_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF NEW.status = 'active' THEN PERFORM public.sync_stakeholder_member_scope(NEW.owner_id, NEW.member_user_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stakeholder_scope_member ON public.account_members;
CREATE TRIGGER stakeholder_scope_member AFTER INSERT OR UPDATE OF status, all_properties ON public.account_members
  FOR EACH ROW EXECUTE FUNCTION public.trg_stakeholder_scope_member();

CREATE OR REPLACE FUNCTION public.trg_stakeholder_scope_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _owner uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;
  r := COALESCE(NEW, OLD);
  IF TG_TABLE_NAME = 'properties' THEN
    _owner := (to_jsonb(r)->>'owner_id')::uuid;
  ELSE
    _owner := (to_jsonb(r)->>'account_owner_id')::uuid;
  END IF;
  FOR r IN SELECT member_user_id FROM public.account_members WHERE owner_id = _owner AND status = 'active' LOOP
    PERFORM public.sync_stakeholder_member_scope(_owner, r.member_user_id);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS stakeholder_scope_pp ON public.property_providers;
CREATE TRIGGER stakeholder_scope_pp AFTER INSERT OR UPDATE OR DELETE ON public.property_providers
  FOR EACH ROW EXECUTE FUNCTION public.trg_stakeholder_scope_links();
DROP TRIGGER IF EXISTS stakeholder_scope_sp ON public.service_providers;
CREATE TRIGGER stakeholder_scope_sp AFTER INSERT OR UPDATE OF email, member_user_id ON public.service_providers
  FOR EACH ROW EXECUTE FUNCTION public.trg_stakeholder_scope_links();
DROP TRIGGER IF EXISTS stakeholder_scope_po ON public.property_owners;
CREATE TRIGGER stakeholder_scope_po AFTER INSERT OR UPDATE OF email ON public.property_owners
  FOR EACH ROW EXECUTE FUNCTION public.trg_stakeholder_scope_links();
DROP TRIGGER IF EXISTS stakeholder_scope_prop ON public.properties;
CREATE TRIGGER stakeholder_scope_prop AFTER UPDATE OF owner_contact_id ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.trg_stakeholder_scope_links();

-- correção imediata de todas as contas
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT owner_id, member_user_id FROM public.account_members WHERE status='active' LOOP
    PERFORM public.sync_stakeholder_member_scope(r.owner_id, r.member_user_id);
  END LOOP;
END $$;
