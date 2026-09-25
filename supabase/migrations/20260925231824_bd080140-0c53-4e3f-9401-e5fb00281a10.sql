ALTER TABLE public.properties ALTER COLUMN tagline SET DEFAULT 'Check-In & Check-Out';
ALTER TABLE public.properties ALTER COLUMN require_access_gate SET DEFAULT true;
UPDATE public.properties SET tagline = 'Check-In & Check-Out', require_access_gate = true
WHERE tagline IS DISTINCT FROM 'Check-In & Check-Out' OR require_access_gate IS DISTINCT FROM true;