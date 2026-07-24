-- Airbnb iCal integration: campos por guia + tabela de reservas sincronizadas
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS airbnb_ical_url text,
  ADD COLUMN IF NOT EXISTS airbnb_ical_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS airbnb_ical_last_error text;

CREATE TABLE IF NOT EXISTS public.property_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'airbnb',
  external_uid text NOT NULL,
  checkin_date date NOT NULL,
  checkout_date date NOT NULL,
  raw_summary text,
  guest_hint text,
  reservation_url text,
  status text NOT NULL DEFAULT 'confirmed',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, source, external_uid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_reservations TO authenticated;
GRANT ALL ON public.property_reservations TO service_role;

ALTER TABLE public.property_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners/members can read reservations"
  ON public.property_reservations FOR SELECT
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

CREATE POLICY "Owners/members can manage reservations"
  ON public.property_reservations FOR ALL
  TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

CREATE INDEX IF NOT EXISTS idx_property_reservations_property_dates
  ON public.property_reservations (property_id, checkin_date, checkout_date);

CREATE TRIGGER trg_property_reservations_touch
  BEFORE UPDATE ON public.property_reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- pg_cron: sync a cada 30 minutos
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  PERFORM cron.unschedule('sync-airbnb-ical');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'sync-airbnb-ical',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron.sync-airbnb-ical',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwb2l4bnVtZ2F3a2NhdmlsendvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDMzODIsImV4cCI6MjA5Njc3OTM4Mn0.d_ymwSgErCuS1xm7y6yz1zONKFK1lJP5S56lWScA0EE'
    ),
    body := '{}'::jsonb
  );
  $$
);