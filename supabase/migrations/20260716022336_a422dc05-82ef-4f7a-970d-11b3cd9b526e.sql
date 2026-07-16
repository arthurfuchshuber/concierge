
CREATE TABLE public.property_daily_tips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  date date NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, date)
);
GRANT SELECT ON public.property_daily_tips TO anon, authenticated;
GRANT ALL ON public.property_daily_tips TO service_role;
ALTER TABLE public.property_daily_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read daily tips" ON public.property_daily_tips FOR SELECT USING (true);
CREATE INDEX idx_property_daily_tips_lookup ON public.property_daily_tips(property_id, date DESC);

CREATE TABLE public.city_daily_pulse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL,
  date date NOT NULL,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_key, date)
);
GRANT SELECT ON public.city_daily_pulse TO anon, authenticated;
GRANT ALL ON public.city_daily_pulse TO service_role;
ALTER TABLE public.city_daily_pulse ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read city pulse" ON public.city_daily_pulse FOR SELECT USING (true);
CREATE INDEX idx_city_daily_pulse_lookup ON public.city_daily_pulse(city_key, date DESC);
