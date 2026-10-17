DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['property_checkout_items','property_emergency_contacts','property_faqs','property_types','guest_itineraries','property_manual_items'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;