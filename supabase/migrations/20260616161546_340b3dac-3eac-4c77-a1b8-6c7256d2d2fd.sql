ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS checkin_note text,
  ADD COLUMN IF NOT EXISTS checkout_note text,
  ADD COLUMN IF NOT EXISTS access_codes_pin text;