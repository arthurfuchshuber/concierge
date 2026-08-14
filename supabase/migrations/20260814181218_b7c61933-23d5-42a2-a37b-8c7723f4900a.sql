CREATE TABLE IF NOT EXISTS public.property_types (
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

DROP POLICY IF EXISTS "Account can manage property types" ON public.property_types;
CREATE POLICY "Account can manage property types"
  ON public.property_types FOR ALL
  TO authenticated
  USING ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id))
  WITH CHECK ((account_owner_id = auth.uid()) OR is_account_member(auth.uid(), account_owner_id));

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS property_type_id uuid REFERENCES public.property_types(id) ON DELETE SET NULL;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS guide_created boolean NOT NULL DEFAULT false;

UPDATE public.properties p
SET guide_created = true
WHERE guide_created = false
  AND (
    p.published
    OR coalesce(p.house_rules, '') <> ''
    OR coalesce(p.wifi_ssid, '') <> ''
    OR coalesce(p.checkin_instructions, '') <> ''
    OR EXISTS (SELECT 1 FROM public.property_manual_items m WHERE m.property_id = p.id)
    OR EXISTS (SELECT 1 FROM public.property_faqs f WHERE f.property_id = p.id)
    OR EXISTS (SELECT 1 FROM public.property_checkout_items c WHERE c.property_id = p.id)
    OR EXISTS (SELECT 1 FROM public.property_recommendations r WHERE r.property_id = p.id)
  );