-- ============ property_owners ============
CREATE TABLE public.property_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade_name text,
  doc_type text NOT NULL DEFAULT 'cpf',
  doc text,
  email text,
  phone text,
  phone_country text DEFAULT 'BR',
  address text,
  city text,
  state text,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_owners TO authenticated;
GRANT ALL ON public.property_owners TO service_role;
ALTER TABLE public.property_owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage owners" ON public.property_owners
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX property_owners_account_idx ON public.property_owners(account_owner_id);
CREATE TRIGGER property_owners_touch BEFORE UPDATE ON public.property_owners
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ service_providers ============
CREATE TABLE public.service_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  trade_name text,
  category text NOT NULL DEFAULT 'outros',
  doc_type text NOT NULL DEFAULT 'cpf',
  doc text,
  email text,
  phone text,
  phone_country text DEFAULT 'BR',
  address text,
  city text,
  state text,
  hourly_rate_cents integer,
  notes text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_providers TO authenticated;
GRANT ALL ON public.service_providers TO service_role;
ALTER TABLE public.service_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage providers" ON public.service_providers
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX service_providers_account_idx ON public.service_providers(account_owner_id);
CREATE TRIGGER service_providers_touch BEFORE UPDATE ON public.service_providers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ stakeholder_activities (kanban) ============
CREATE TABLE public.stakeholder_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stakeholder_type text NOT NULL,
  stakeholder_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'normal',
  due_date date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakeholder_activities TO authenticated;
GRANT ALL ON public.stakeholder_activities TO service_role;
ALTER TABLE public.stakeholder_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage activities" ON public.stakeholder_activities
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX stakeholder_activities_lookup_idx ON public.stakeholder_activities(account_owner_id, stakeholder_type, stakeholder_id);
CREATE TRIGGER stakeholder_activities_touch BEFORE UPDATE ON public.stakeholder_activities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ stakeholder_events (timeline) ============
CREATE TABLE public.stakeholder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stakeholder_type text NOT NULL,
  stakeholder_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakeholder_events TO authenticated;
GRANT ALL ON public.stakeholder_events TO service_role;
ALTER TABLE public.stakeholder_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage events" ON public.stakeholder_events
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX stakeholder_events_lookup_idx ON public.stakeholder_events(account_owner_id, stakeholder_type, stakeholder_id, created_at DESC);

-- ============ link properties -> owners ============
ALTER TABLE public.properties
  ADD COLUMN owner_contact_id uuid REFERENCES public.property_owners(id) ON DELETE SET NULL;
CREATE INDEX properties_owner_contact_idx ON public.properties(owner_contact_id);

-- ============ realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.property_owners;
ALTER PUBLICATION supabase_realtime ADD TABLE public.service_providers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stakeholder_activities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.stakeholder_events;