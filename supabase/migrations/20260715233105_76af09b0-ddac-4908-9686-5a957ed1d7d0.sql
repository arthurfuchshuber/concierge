
ALTER TABLE public.property_chat_messages
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_mime text,
  ADD COLUMN IF NOT EXISTS attachment_duration_ms integer,
  ADD COLUMN IF NOT EXISTS attachment_size_bytes integer,
  ADD COLUMN IF NOT EXISTS attachment_name text;

-- Storage policies on chat-attachments bucket.
-- Path convention: <property_id>/<conversation_id>/<uuid>.<ext>
CREATE POLICY "Staff can read chat attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.user_can_access_property(
      auth.uid(),
      (regexp_split_to_array(name, '/'))[1]::uuid
    )
  );

CREATE POLICY "Staff can upload chat attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND public.user_can_access_property(
      auth.uid(),
      (regexp_split_to_array(name, '/'))[1]::uuid
    )
  );

CREATE POLICY "Staff can delete their chat attachments"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND public.user_can_access_property(
      auth.uid(),
      (regexp_split_to_array(name, '/'))[1]::uuid
    )
  );
