-- =====================================================================
-- 1. ENTERPRISE AUDIT TRAIL — ai_system_events
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ai_system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  organization_id uuid,
  user_id uuid,
  actor_type text NOT NULL DEFAULT 'SYSTEM',
  actor_id text,
  actor_name text,
  actor_role text,
  permission_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_type text NOT NULL,
  event_category text NOT NULL,
  entity_type text,
  entity_id text,
  action text,
  description text,
  reason text,
  source text NOT NULL DEFAULT 'system',
  channel text,
  ip_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'info',
  conversation_id uuid,
  property_id uuid,
  correlation_id uuid,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_system_events TO authenticated;
GRANT ALL ON public.ai_system_events TO service_role;

ALTER TABLE public.ai_system_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant reads own system events"
  ON public.ai_system_events FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR tenant_id = auth.uid()
    OR (tenant_id IS NOT NULL AND public.is_account_member(auth.uid(), tenant_id))
  );

CREATE INDEX IF NOT EXISTS ai_system_events_tenant_created_idx ON public.ai_system_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_system_events_category_idx ON public.ai_system_events (event_category, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_system_events_type_idx ON public.ai_system_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_system_events_actor_idx ON public.ai_system_events (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS ai_system_events_conversation_idx ON public.ai_system_events (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_system_events_correlation_idx ON public.ai_system_events (correlation_id, created_at);
CREATE INDEX IF NOT EXISTS ai_system_events_severity_idx ON public.ai_system_events (severity, created_at DESC);

-- =====================================================================
-- 2. KNOWLEDGE GOVERNANCE — ai_tenant_knowledge (Conhecimento da Operação)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ai_tenant_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'geral',
  content text NOT NULL,
  knowledge_scope text NOT NULL DEFAULT 'TENANT_KNOWLEDGE',
  priority integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active',
  author_id uuid,
  author_name text,
  source text NOT NULL DEFAULT 'manual',
  source_learning_id uuid,
  applied_memory_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_tenant_knowledge TO authenticated;
GRANT ALL ON public.ai_tenant_knowledge TO service_role;

ALTER TABLE public.ai_tenant_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account manages own operational knowledge"
  ON public.ai_tenant_knowledge FOR ALL TO authenticated
  USING (
    tenant_id = auth.uid()
    OR public.is_account_member(auth.uid(), tenant_id)
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    tenant_id = auth.uid()
    OR public.is_account_member(auth.uid(), tenant_id)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE INDEX IF NOT EXISTS ai_tenant_knowledge_tenant_idx ON public.ai_tenant_knowledge (tenant_id, status, priority);
CREATE INDEX IF NOT EXISTS ai_tenant_knowledge_property_idx ON public.ai_tenant_knowledge (property_id);

CREATE TRIGGER ai_tenant_knowledge_touch
  BEFORE UPDATE ON public.ai_tenant_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 3. GLOBAL INTELLIGENCE (SaaS-wide knowledge)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ai_global_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  insight text NOT NULL,
  category text NOT NULL DEFAULT 'best_practice',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_conversations integer NOT NULL DEFAULT 0,
  source_tenants integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0.5,
  impact_estimate text,
  impact_percentage numeric,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_global_intelligence TO authenticated;
GRANT ALL ON public.ai_global_intelligence TO service_role;

ALTER TABLE public.ai_global_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published global intelligence is readable"
  ON public.ai_global_intelligence FOR SELECT TO authenticated
  USING (status = 'published' OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Platform admins manage global intelligence"
  ON public.ai_global_intelligence FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Platform admins update global intelligence"
  ON public.ai_global_intelligence FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Platform admins delete global intelligence"
  ON public.ai_global_intelligence FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS ai_global_intelligence_status_idx ON public.ai_global_intelligence (status, created_at DESC);

CREATE TRIGGER ai_global_intelligence_touch
  BEFORE UPDATE ON public.ai_global_intelligence
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 4. LEARNING <-> AUDIT RELATIONSHIP
-- =====================================================================
ALTER TABLE public.ai_learning_candidates
  ADD COLUMN IF NOT EXISTS event_origin text,
  ADD COLUMN IF NOT EXISTS tenant_origin uuid,
  ADD COLUMN IF NOT EXISTS approval_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS application_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS promoted_global_id uuid REFERENCES public.ai_global_intelligence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimated_impact text;