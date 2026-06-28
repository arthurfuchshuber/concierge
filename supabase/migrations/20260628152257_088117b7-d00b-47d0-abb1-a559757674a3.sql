
-- Admin invites
CREATE TABLE IF NOT EXISTS public.admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | accepted | revoked
  accepted_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_invites TO authenticated;
GRANT ALL ON public.admin_invites TO service_role;
ALTER TABLE public.admin_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view invites" ON public.admin_invites;
CREATE POLICY "Admins can view invites" ON public.admin_invites
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Audit logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON public.audit_logs (action);

GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Generic logging trigger function: captures inserts/updates/deletes on app tables
CREATE OR REPLACE FUNCTION public.log_table_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_user uuid := auth.uid();
  acting_email text;
  entity text := TG_TABLE_NAME;
  entity_id_v text;
  action_v text;
  meta jsonb := '{}'::jsonb;
BEGIN
  IF acting_user IS NULL THEN
    -- ignore service_role / system actions (logged explicitly via app helper)
    RETURN COALESCE(NEW, OLD);
  END IF;

  BEGIN
    SELECT email INTO acting_email FROM auth.users WHERE id = acting_user;
  EXCEPTION WHEN OTHERS THEN
    acting_email := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    action_v := entity || '.create';
    BEGIN entity_id_v := (to_jsonb(NEW)->>'id'); EXCEPTION WHEN OTHERS THEN entity_id_v := NULL; END;
    meta := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    action_v := entity || '.update';
    BEGIN entity_id_v := (to_jsonb(NEW)->>'id'); EXCEPTION WHEN OTHERS THEN entity_id_v := NULL; END;
    meta := jsonb_build_object('changed_keys', (
      SELECT jsonb_agg(key) FROM jsonb_each(to_jsonb(NEW))
      WHERE to_jsonb(NEW)->key IS DISTINCT FROM to_jsonb(OLD)->key
    ));
  ELSIF TG_OP = 'DELETE' THEN
    action_v := entity || '.delete';
    BEGIN entity_id_v := (to_jsonb(OLD)->>'id'); EXCEPTION WHEN OTHERS THEN entity_id_v := NULL; END;
    meta := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
  VALUES (acting_user, acting_email, action_v, entity, entity_id_v, meta);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach triggers to key tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'properties',
    'property_recommendations',
    'property_faqs',
    'property_manual_items',
    'property_checkout_items',
    'property_emergency_contacts',
    'city_references',
    'city_reference_groups',
    'city_reference_group_members',
    'poi_categories',
    'poi_tags',
    'host_knowledge',
    'host_behavior',
    'host_faqs',
    'sigma_city_packs',
    'sigma_city_recommendations',
    'sigma_city_marketplace',
    'sigma_city_faqs',
    'subscriptions',
    'user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_table_change()',
      t, t
    );
  END LOOP;
END $$;

-- Auto-promote pending invitees on signup
CREATE OR REPLACE FUNCTION public.accept_admin_invite_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
BEGIN
  SELECT id INTO inv_id FROM public.admin_invites
    WHERE lower(email) = lower(NEW.email) AND status = 'pending'
    LIMIT 1;
  IF inv_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
      ON CONFLICT DO NOTHING;
    UPDATE public.admin_invites
      SET status = 'accepted', accepted_user_id = NEW.id, accepted_at = now(), updated_at = now()
      WHERE id = inv_id;
    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
    VALUES (NEW.id, NEW.email, 'admin_invite.accepted', 'admin_invites', inv_id::text, '{}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_accept_admin_invite ON auth.users;
CREATE TRIGGER on_auth_user_accept_admin_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.accept_admin_invite_on_signup();
