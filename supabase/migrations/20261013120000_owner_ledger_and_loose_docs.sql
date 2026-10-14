-- Financeiro do proprietário (lançamentos a receber / a pagar)
CREATE TABLE IF NOT EXISTS public.owner_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stakeholder_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('receivable','payable')),
  description text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  due_date date NOT NULL,
  paid_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_ledger_entries TO authenticated;
GRANT ALL ON public.owner_ledger_entries TO service_role;
ALTER TABLE public.owner_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage ledger" ON public.owner_ledger_entries
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX IF NOT EXISTS owner_ledger_lookup_idx ON public.owner_ledger_entries(account_owner_id, stakeholder_id, due_date DESC);
CREATE TRIGGER owner_ledger_touch BEFORE UPDATE ON public.owner_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Documentos avulsos (PDF anexado direto, sem passar pelo ClickSign)
CREATE TABLE IF NOT EXISTS public.owner_loose_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stakeholder_id uuid NOT NULL REFERENCES public.property_owners(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  size_bytes bigint,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_loose_documents TO authenticated;
GRANT ALL ON public.owner_loose_documents TO service_role;
ALTER TABLE public.owner_loose_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage loose docs" ON public.owner_loose_documents
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX IF NOT EXISTS owner_loose_docs_lookup_idx ON public.owner_loose_documents(account_owner_id, stakeholder_id, created_at DESC);

INSERT INTO storage.buckets (id, name, public) VALUES ('owner-documents', 'owner-documents', false)
ON CONFLICT (id) DO NOTHING;
