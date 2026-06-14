-- Add storage.objects policies allowing authenticated owners to read/write their property-images
-- and service_role to read all (used for signing).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='property-images authed select') THEN
    CREATE POLICY "property-images authed select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'property-images');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='property-images authed insert') THEN
    CREATE POLICY "property-images authed insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'property-images');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='property-images authed update') THEN
    CREATE POLICY "property-images authed update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'property-images') WITH CHECK (bucket_id = 'property-images');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='property-images authed delete') THEN
    CREATE POLICY "property-images authed delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'property-images');
  END IF;
END $$;