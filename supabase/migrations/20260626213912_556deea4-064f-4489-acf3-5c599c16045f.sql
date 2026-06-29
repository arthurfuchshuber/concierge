
-- ============================================================
-- SIGMACONCIERGE RECOMMENDATIONS PACKS (admin-curated by city)
-- ============================================================

-- 1) Cidade-pack (1 linha por cidade)
CREATE TABLE public.sigma_city_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL UNIQUE,
  city_label text NOT NULL,
  country text,
  cover_url text,
  is_published boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sigma_city_packs TO anon, authenticated;
GRANT ALL ON public.sigma_city_packs TO service_role;
ALTER TABLE public.sigma_city_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sigma_packs_public_read_published"
  ON public.sigma_city_packs FOR SELECT
  USING (is_published = true OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sigma_packs_admin_write"
  ON public.sigma_city_packs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Pontos/estabelecimentos curados (espelha city_references)
CREATE TABLE public.sigma_city_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL REFERENCES public.sigma_city_packs(city_key) ON DELETE CASCADE ON UPDATE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  category text,
  rating numeric,
  user_ratings_total integer,
  note text,
  image_url text,
  maps_url text,
  place_id text,
  address text,
  lat double precision,
  lng double precision,
  opening_hours text[],
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sigma_recs_city_place_unique
  ON public.sigma_city_recommendations(city_key, place_id) WHERE place_id IS NOT NULL;
GRANT SELECT ON public.sigma_city_recommendations TO anon, authenticated;
GRANT ALL ON public.sigma_city_recommendations TO service_role;
ALTER TABLE public.sigma_city_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sigma_recs_public_read_published"
  ON public.sigma_city_recommendations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.sigma_city_packs p
            WHERE p.city_key = sigma_city_recommendations.city_key
              AND (p.is_published = true OR public.has_role(auth.uid(), 'admin')))
  );
CREATE POLICY "sigma_recs_admin_write"
  ON public.sigma_city_recommendations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) Reservas & Marketplace
CREATE TABLE public.sigma_city_marketplace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL REFERENCES public.sigma_city_packs(city_key) ON DELETE CASCADE ON UPDATE CASCADE,
  label text NOT NULL,
  url text NOT NULL,
  description text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sigma_city_marketplace TO anon, authenticated;
GRANT ALL ON public.sigma_city_marketplace TO service_role;
ALTER TABLE public.sigma_city_marketplace ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sigma_mkt_public_read_published"
  ON public.sigma_city_marketplace FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.sigma_city_packs p
            WHERE p.city_key = sigma_city_marketplace.city_key
              AND (p.is_published = true OR public.has_role(auth.uid(), 'admin')))
  );
CREATE POLICY "sigma_mkt_admin_write"
  ON public.sigma_city_marketplace FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) FAQs por cidade
CREATE TABLE public.sigma_city_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL REFERENCES public.sigma_city_packs(city_key) ON DELETE CASCADE ON UPDATE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sigma_city_faqs TO anon, authenticated;
GRANT ALL ON public.sigma_city_faqs TO service_role;
ALTER TABLE public.sigma_city_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sigma_faqs_public_read_published"
  ON public.sigma_city_faqs FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.sigma_city_packs p
            WHERE p.city_key = sigma_city_faqs.city_key
              AND (p.is_published = true OR public.has_role(auth.uid(), 'admin')))
  );
CREATE POLICY "sigma_faqs_admin_write"
  ON public.sigma_city_faqs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) Vincular um pack ao guia do usuário + snapshot do conteúdo anterior
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS sigma_pack_city_key text,
  ADD COLUMN IF NOT EXISTS sigma_pack_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS sigma_pack_snapshot jsonb;

-- 6) Onboarding por usuário
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- 7) Triggers de updated_at
CREATE TRIGGER trg_sigma_packs_updated BEFORE UPDATE ON public.sigma_city_packs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sigma_recs_updated BEFORE UPDATE ON public.sigma_city_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sigma_mkt_updated BEFORE UPDATE ON public.sigma_city_marketplace
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_sigma_faqs_updated BEFORE UPDATE ON public.sigma_city_faqs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
