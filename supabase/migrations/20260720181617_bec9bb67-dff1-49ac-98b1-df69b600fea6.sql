
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS collect_arrival_time text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS collect_vehicles text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS vehicles_max integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS collect_document text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS document_scope text NOT NULL DEFAULT 'main';

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_collect_arrival_time_check,
  DROP CONSTRAINT IF EXISTS properties_collect_vehicles_check,
  DROP CONSTRAINT IF EXISTS properties_collect_document_check,
  DROP CONSTRAINT IF EXISTS properties_document_scope_check,
  DROP CONSTRAINT IF EXISTS properties_vehicles_max_check;

ALTER TABLE public.properties
  ADD CONSTRAINT properties_collect_arrival_time_check CHECK (collect_arrival_time IN ('off','optional','required')),
  ADD CONSTRAINT properties_collect_vehicles_check CHECK (collect_vehicles IN ('off','optional','required')),
  ADD CONSTRAINT properties_collect_document_check CHECK (collect_document IN ('off','optional','required')),
  ADD CONSTRAINT properties_document_scope_check CHECK (document_scope IN ('main','all')),
  ADD CONSTRAINT properties_vehicles_max_check CHECK (vehicles_max BETWEEN 0 AND 10);

ALTER TABLE public.guide_access_logs
  ADD COLUMN IF NOT EXISTS guest_arrival_time text,
  ADD COLUMN IF NOT EXISTS guest_vehicles jsonb,
  ADD COLUMN IF NOT EXISTS guest_documents jsonb;
