-- Habilita Realtime nas tabelas do imóvel/guia que ainda não estavam
-- publicadas. Sem isto, o hook useRealtimeInvalidate simplesmente nunca
-- recebe evento nenhum — a assinatura no cliente fica "correta" mas muda
-- nada, porque o Postgres nunca notifica ninguém sobre essas tabelas.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'properties'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.properties;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'property_manual_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_manual_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'property_faqs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_faqs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'property_checkout_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_checkout_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'property_emergency_contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_emergency_contacts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'property_types'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_types;
  END IF;
END $$;
