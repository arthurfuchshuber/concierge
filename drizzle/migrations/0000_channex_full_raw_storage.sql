CREATE TABLE public.channex_raw_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  channex_id text NOT NULL,
  parent_id text,
  channex_property_id text,
  property_id uuid,
  payload jsonb NOT NULL,
  source text NOT NULL DEFAULT 'backfill',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, channex_id)
);
CREATE INDEX channex_raw_records_property_idx ON public.channex_raw_records (property_id, entity_type);
CREATE INDEX channex_raw_records_parent_idx ON public.channex_raw_records (parent_id);
GRANT SELECT ON public.channex_raw_records TO authenticated;
GRANT ALL ON public.channex_raw_records TO service_role;
ALTER TABLE public.channex_raw_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read channex raw records" ON public.channex_raw_records
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

ALTER TABLE public.property_reservations
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS ota_commission numeric,
  ADD COLUMN IF NOT EXISTS payment_collect text,
  ADD COLUMN IF NOT EXISTS payment_type text,
  ADD COLUMN IF NOT EXISTS ota_name text,
  ADD COLUMN IF NOT EXISTS occupancy jsonb,
  ADD COLUMN IF NOT EXISTS daily_rates jsonb,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;