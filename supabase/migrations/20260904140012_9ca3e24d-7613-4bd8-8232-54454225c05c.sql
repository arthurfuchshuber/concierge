CREATE TABLE public.property_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, provider_id)
);

CREATE INDEX idx_property_providers_provider ON public.property_providers(provider_id);
CREATE INDEX idx_property_providers_property ON public.property_providers(property_id);
CREATE INDEX idx_property_providers_account ON public.property_providers(account_owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_providers TO authenticated;
GRANT ALL ON public.property_providers TO service_role;

ALTER TABLE public.property_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can manage property providers"
ON public.property_providers FOR ALL TO authenticated
USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));

CREATE TRIGGER update_property_providers_updated_at
BEFORE UPDATE ON public.property_providers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();