DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'guest_arrival_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_arrival_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'guide_access_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guide_access_logs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'property_reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_reservations;
  END IF;
END $$;