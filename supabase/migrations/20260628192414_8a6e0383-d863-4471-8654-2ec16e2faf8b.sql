ALTER TABLE public.host_faqs ADD COLUMN IF NOT EXISTS scope_property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;
ALTER TABLE public.host_knowledge ADD COLUMN IF NOT EXISTS scope_property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;
ALTER TABLE public.host_behavior ADD COLUMN IF NOT EXISTS scope_property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_host_faqs_scope ON public.host_faqs(scope_property_id);
CREATE INDEX IF NOT EXISTS idx_host_knowledge_scope ON public.host_knowledge(scope_property_id);
CREATE INDEX IF NOT EXISTS idx_host_behavior_scope ON public.host_behavior(scope_property_id);