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
      'x-cron-secret', 'UiKfyYqTqxI-3zrXDuFwikiJwD-9rwqk5P0GtrGNdQd70t-qqRaAtMgL_Y3FMrmv'
    ),
    body := jsonb_build_object('limit', 200)
  ) AS request_id;
  $$
);