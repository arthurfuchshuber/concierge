ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS checkin_instructions text,
  ADD COLUMN IF NOT EXISTS checkin_media jsonb NOT NULL DEFAULT '[]'::jsonb;