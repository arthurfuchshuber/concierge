ALTER TABLE public.property_owners ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'manual';
ALTER TABLE public.service_providers ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS property_owners_created_via_idx ON public.property_owners (account_owner_id, created_via);
CREATE INDEX IF NOT EXISTS service_providers_created_via_idx ON public.service_providers (account_owner_id, created_via);