CREATE TABLE public.landing_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT,
  properties_count TEXT,
  whatsapp TEXT,
  email TEXT NOT NULL,
  challenge TEXT,
  source TEXT NOT NULL DEFAULT 'landing',
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.landing_leads TO service_role;
GRANT SELECT ON public.landing_leads TO authenticated;

ALTER TABLE public.landing_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read landing leads"
  ON public.landing_leads FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_landing_leads_updated_at
  BEFORE UPDATE ON public.landing_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX landing_leads_created_at_idx ON public.landing_leads (created_at DESC);
