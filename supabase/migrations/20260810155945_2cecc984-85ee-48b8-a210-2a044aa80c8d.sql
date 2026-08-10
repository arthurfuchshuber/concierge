CREATE TABLE public.provider_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL,
  slug text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, slug)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_categories TO authenticated;
GRANT ALL ON public.provider_categories TO service_role;

ALTER TABLE public.provider_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can manage provider categories"
  ON public.provider_categories FOR ALL
  TO authenticated
  USING ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id))
  WITH CHECK ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id));

ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.service_providers SET categories = ARRAY[category] WHERE category IS NOT NULL AND cardinality(categories) = 0;