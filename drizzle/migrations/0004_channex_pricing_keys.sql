CREATE TABLE public.channex_pricing_keys (
  owner_id uuid PRIMARY KEY,
  channex_key_id text NOT NULL,
  api_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.channex_pricing_keys TO service_role;
ALTER TABLE public.channex_pricing_keys ENABLE ROW LEVEL SECURITY;