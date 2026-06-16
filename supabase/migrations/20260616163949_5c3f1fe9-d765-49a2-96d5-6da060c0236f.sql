ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS gate_label TEXT,
  ADD COLUMN IF NOT EXISTS lock_label TEXT;