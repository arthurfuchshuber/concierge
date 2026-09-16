-- Tipos de imóvel: taxonomia editável por conta (igual padrão de provider_categories) —
-- lista padrão semeada na primeira leitura, e a partir daí o anfitrião pode renomear,
-- excluir ou criar novas opções livremente.
CREATE TABLE public.property_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_types TO authenticated;
GRANT ALL ON public.property_types TO service_role;

ALTER TABLE public.property_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can manage property types"
  ON public.property_types FOR ALL
  TO authenticated
  USING ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id))
  WITH CHECK ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id));

-- Tipo do imóvel (FK — renomear uma opção reflete automaticamente em todo imóvel que a usa).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_type_id uuid REFERENCES public.property_types(id) ON DELETE SET NULL;

-- Marca se o anfitrião já avançou da tela enxuta "Informações do imóvel" para o editor
-- completo do guia (aba "O guia" e demais). Enquanto false, abrir o imóvel sempre mostra
-- a tela enxuta — mesmo depois de salvo uma vez — em vez de cair direto nos 6 steps do guia.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS guide_created boolean NOT NULL DEFAULT false;
