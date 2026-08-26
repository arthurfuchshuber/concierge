ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS cleaning_price_normal_cents integer,
  ADD COLUMN IF NOT EXISTS cleaning_price_full_cents integer,
  ADD COLUMN IF NOT EXISTS cleaning_duration_minutes integer;

ALTER TABLE public.guest_arrival_status
  ADD COLUMN IF NOT EXISTS cleaning_type text,
  ADD COLUMN IF NOT EXISTS cleaning_price_cents integer;

ALTER TABLE public.guest_arrival_status
  DROP CONSTRAINT IF EXISTS guest_arrival_status_cleaning_type_check;

ALTER TABLE public.guest_arrival_status
  ADD CONSTRAINT guest_arrival_status_cleaning_type_check
  CHECK (cleaning_type IS NULL OR cleaning_type IN ('normal', 'completa'));