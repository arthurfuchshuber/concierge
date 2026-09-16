
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS state text;

CREATE TABLE IF NOT EXISTS public.city_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL,
  city_label text NOT NULL,
  state text,
  country text NOT NULL DEFAULT 'BR',
  category text NOT NULL,
  type text NOT NULL,
  place_id text,
  name text NOT NULL,
  note text,
  address text,
  rating numeric,
  user_ratings_total integer,
  primary_type text,
  lat double precision,
  lng double precision,
  image_url text,
  maps_url text,
  opening_hours text[],
  source text NOT NULL DEFAULT 'auto',
  is_hidden boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT city_references_source_chk CHECK (source IN ('auto','manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS city_references_unique_place
  ON public.city_references (city_key, COALESCE(state,''), country, COALESCE(place_id, name));

CREATE INDEX IF NOT EXISTS city_references_lookup
  ON public.city_references (city_key, country) WHERE is_hidden = false;

GRANT SELECT ON public.city_references TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_references TO authenticated;
GRANT ALL ON public.city_references TO service_role;

ALTER TABLE public.city_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "city_references public read visible"
  ON public.city_references FOR SELECT
  TO anon, authenticated
  USING (is_hidden = false);

CREATE POLICY "city_references admin read all"
  ON public.city_references FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "city_references admin write"
  ON public.city_references FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER city_references_touch_updated_at
  BEFORE UPDATE ON public.city_references
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.city_reference_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL,
  city_label text NOT NULL,
  state text,
  country text NOT NULL DEFAULT 'BR',
  last_refreshed_at timestamptz,
  last_status text,
  last_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS city_reference_jobs_unique
  ON public.city_reference_jobs (city_key, COALESCE(state,''), country);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.city_reference_jobs TO authenticated;
GRANT ALL ON public.city_reference_jobs TO service_role;

ALTER TABLE public.city_reference_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "city_reference_jobs admin all"
  ON public.city_reference_jobs FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER city_reference_jobs_touch_updated_at
  BEFORE UPDATE ON public.city_reference_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
