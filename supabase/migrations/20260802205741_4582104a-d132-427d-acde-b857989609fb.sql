ALTER TABLE public.host_integration_credentials
  ADD COLUMN IF NOT EXISTS webhook_secret text,
  ADD COLUMN IF NOT EXISTS webhook_last_event_at timestamptz;