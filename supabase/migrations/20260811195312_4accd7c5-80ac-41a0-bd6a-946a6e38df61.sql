CREATE TABLE public.property_details (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  images JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL DEFAULT 'text',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX property_details_property_idx ON public.property_details(property_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_details TO authenticated;
GRANT ALL ON public.property_details TO service_role;

ALTER TABLE public.property_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and team can read property details"
  ON public.property_details FOR SELECT TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id));

CREATE POLICY "Owners and team can write property details"
  ON public.property_details FOR ALL TO authenticated
  USING (public.user_can_access_property(auth.uid(), property_id))
  WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

CREATE TRIGGER update_property_details_updated_at
  BEFORE UPDATE ON public.property_details
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();