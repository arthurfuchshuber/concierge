ALTER TABLE public.property_owners
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'pf',
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS district text;

ALTER TABLE public.service_providers
  ADD COLUMN IF NOT EXISTS person_type text NOT NULL DEFAULT 'pf',
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS district text;