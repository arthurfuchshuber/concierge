CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-guide-recommendations-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-guide-recommendations-daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-guide-recommendations-daily',
  '0 6 * * *',
  $$
  SELECT extensions.http_post(
    url := 'https://project--c6a061b9-4ae8-4241-9a99-3375bda32242.lovable.app/api/public/cron/refresh-recommendations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRwb2l4bnVtZ2F3a2NhdmlsendvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDMzODIsImV4cCI6MjA5Njc3OTM4Mn0.d_ymwSgErCuS1xm7y6yz1zONKFK1lJP5S56lWScA0EE'
    ),
    body := jsonb_build_object('limit', 200)
  ) AS request_id;
  $$
);