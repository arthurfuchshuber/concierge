CREATE TABLE public.host_integration_credentials (
  owner_id uuid NOT NULL,
  provider text NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  api_token_encrypted text,
  status text NOT NULL DEFAULT 'pending',
  last_verified_at timestamptz,
  last_error text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_integration_credentials TO authenticated;
GRANT ALL ON public.host_integration_credentials TO service_role;
ALTER TABLE public.host_integration_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own integration credentials"
  ON public.host_integration_credentials FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE TABLE public.clicksign_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  document_key text NOT NULL,
  name text,
  status text,
  signers jsonb NOT NULL DEFAULT '[]'::jsonb,
  url_original text,
  url_signed text,
  finished_at timestamptz,
  stakeholder_type text,
  stakeholder_id uuid,
  guest_name text,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, document_key)
);

CREATE INDEX clicksign_documents_account_idx ON public.clicksign_documents(account_owner_id, status);
CREATE INDEX clicksign_documents_stakeholder_idx ON public.clicksign_documents(stakeholder_type, stakeholder_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clicksign_documents TO authenticated;
GRANT ALL ON public.clicksign_documents TO service_role;
ALTER TABLE public.clicksign_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can view clicksign documents"
  ON public.clicksign_documents FOR SELECT TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));

CREATE POLICY "Owner manages clicksign documents"
  ON public.clicksign_documents FOR ALL TO authenticated
  USING (account_owner_id = auth.uid()) WITH CHECK (account_owner_id = auth.uid());

CREATE TRIGGER host_integration_credentials_touch BEFORE UPDATE ON public.host_integration_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER clicksign_documents_touch BEFORE UPDATE ON public.clicksign_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();