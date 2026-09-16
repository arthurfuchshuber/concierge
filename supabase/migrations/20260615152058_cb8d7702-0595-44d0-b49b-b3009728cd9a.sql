
CREATE TABLE IF NOT EXISTS public.host_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_faqs TO authenticated;
GRANT ALL ON public.host_faqs TO service_role;
ALTER TABLE public.host_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "host_faqs owner all" ON public.host_faqs FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS host_faqs_owner_idx ON public.host_faqs(owner_id, position);
CREATE TRIGGER host_faqs_touch BEFORE UPDATE ON public.host_faqs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.host_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_knowledge TO authenticated;
GRANT ALL ON public.host_knowledge TO service_role;
ALTER TABLE public.host_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "host_knowledge owner all" ON public.host_knowledge FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE INDEX IF NOT EXISTS host_knowledge_owner_idx ON public.host_knowledge(owner_id, position);
CREATE TRIGGER host_knowledge_touch BEFORE UPDATE ON public.host_knowledge FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
