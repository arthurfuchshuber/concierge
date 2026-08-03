ALTER TABLE public.property_owners ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;