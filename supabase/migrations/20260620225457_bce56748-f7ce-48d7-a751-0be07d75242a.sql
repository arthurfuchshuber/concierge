-- Add phone fields and make reservation code optional in guide access logs
ALTER TABLE public.guide_access_logs
  ADD COLUMN IF NOT EXISTS guest_phone text,
  ADD COLUMN IF NOT EXISTS guest_phone_country text;

ALTER TABLE public.guide_access_logs
  ALTER COLUMN reservation_code DROP NOT NULL;