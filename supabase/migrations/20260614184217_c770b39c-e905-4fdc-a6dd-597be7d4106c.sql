DROP POLICY IF EXISTS "property-images authed select" ON storage.objects;
DROP POLICY IF EXISTS "Public read property-images" ON storage.objects;

CREATE POLICY "Authenticated read own property-images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'property-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);