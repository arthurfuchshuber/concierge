
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS garage_maps_url text;

CREATE TABLE IF NOT EXISTS public.guide_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  reservation_code text NOT NULL,
  checkin_date date NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guide_access_logs_property_idx ON public.guide_access_logs(property_id, created_at DESC);

GRANT INSERT ON public.guide_access_logs TO anon, authenticated;
GRANT SELECT ON public.guide_access_logs TO authenticated;
GRANT ALL ON public.guide_access_logs TO service_role;

ALTER TABLE public.guide_access_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can register guide access"
  ON public.guide_access_logs
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    char_length(guest_name) BETWEEN 2 AND 200
    AND char_length(reservation_code) BETWEEN 1 AND 100
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id AND p.published = true
    )
  );

CREATE POLICY "Owners can read their guide access logs"
  ON public.guide_access_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_id AND p.owner_id = auth.uid()
    )
  );
