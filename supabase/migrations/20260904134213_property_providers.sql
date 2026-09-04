-- ============ property_providers ============
-- Vínculo N:N entre imóveis e prestadores de serviço. Diferente de
-- properties.owner_contact_id (1 imóvel : 1 proprietário, coluna direta),
-- um prestador (ex.: equipe de limpeza) normalmente atende vários imóveis,
-- e um imóvel normalmente tem vários prestadores (limpeza, manutenção,
-- lavanderia...) — por isso tabela de junção em vez de coluna.
CREATE TABLE public.property_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.service_providers(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, provider_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_providers TO authenticated;
GRANT ALL ON public.property_providers TO service_role;
ALTER TABLE public.property_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Account can manage property_providers" ON public.property_providers
  FOR ALL TO authenticated
  USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
  WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));
CREATE INDEX property_providers_account_idx ON public.property_providers(account_owner_id);
CREATE INDEX property_providers_property_idx ON public.property_providers(property_id);
CREATE INDEX property_providers_provider_idx ON public.property_providers(provider_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.property_providers;
