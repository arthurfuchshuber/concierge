CREATE TABLE IF NOT EXISTS public.guide_section_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  section text NOT NULL,
  guest_session_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guide_section_events_property_idx
  ON public.guide_section_events (property_id, created_at DESC);

GRANT INSERT ON public.guide_section_events TO anon;
GRANT INSERT, SELECT ON public.guide_section_events TO authenticated;
GRANT ALL ON public.guide_section_events TO service_role;

ALTER TABLE public.guide_section_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guide_section_events insert anon"
  ON public.guide_section_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "guide_section_events owner read"
  ON public.guide_section_events FOR SELECT
  TO authenticated
  USING (
    property_id IN (
      SELECT id FROM public.properties WHERE owner_id = auth.uid()
    )
  );
