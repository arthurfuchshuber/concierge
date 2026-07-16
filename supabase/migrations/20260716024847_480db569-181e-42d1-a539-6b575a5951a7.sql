
CREATE TABLE public.city_daily_news (
  city_key text NOT NULL,
  date date NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_key, date)
);

GRANT SELECT ON public.city_daily_news TO anon, authenticated;
GRANT ALL ON public.city_daily_news TO service_role;

ALTER TABLE public.city_daily_news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "city_daily_news readable by everyone"
  ON public.city_daily_news FOR SELECT
  USING (true);
