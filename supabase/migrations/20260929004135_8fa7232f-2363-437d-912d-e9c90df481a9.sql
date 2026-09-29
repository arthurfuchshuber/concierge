ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS cleaning_price_override_cents integer,
  ADD COLUMN IF NOT EXISTS cleaning_price_original_cents integer,
  ADD COLUMN IF NOT EXISTS cleaning_price_override_reason text,
  ADD COLUMN IF NOT EXISTS cleaning_price_override_by uuid,
  ADD COLUMN IF NOT EXISTS cleaning_price_override_at timestamptz;