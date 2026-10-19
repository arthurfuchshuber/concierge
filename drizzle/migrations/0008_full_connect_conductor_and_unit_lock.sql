CREATE TABLE public.full_connect_conductors (
  property_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.full_connect_conductors TO service_role;
ALTER TABLE public.full_connect_conductors ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.channex_unit_locks (
  property_id uuid PRIMARY KEY,
  locked_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.channex_unit_locks TO service_role;
ALTER TABLE public.channex_unit_locks ENABLE ROW LEVEL SECURITY;