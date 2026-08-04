-- FASE 3: learning candidates estendidos
ALTER TABLE public.ai_learning_candidates
  ADD COLUMN IF NOT EXISTS source_conversation_id uuid,
  ADD COLUMN IF NOT EXISTS learning_type text NOT NULL DEFAULT 'property_rule',
  ADD COLUMN IF NOT EXISTS extracted_information text,
  ADD COLUMN IF NOT EXISTS suggested_scope text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE INDEX IF NOT EXISTS idx_alc_tenant_status ON public.ai_learning_candidates (tenant_id, approval_status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alc_dedupe ON public.ai_learning_candidates (owner_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- FASE 8: memory intelligence
ALTER TABLE public.ai_memories
  ADD COLUMN IF NOT EXISTS memory_usage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0;

-- FASE 5: métricas de aprendizado por agente
CREATE TABLE IF NOT EXISTS public.ai_agent_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  agent_type text NOT NULL,
  metric text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  previous_value numeric,
  trend text NOT NULL DEFAULT 'flat',
  period text NOT NULL DEFAULT '30d',
  period_start timestamptz NOT NULL DEFAULT now(),
  sample_size integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_agent_learning_metrics TO authenticated;
GRANT ALL ON public.ai_agent_learning_metrics TO service_role;
ALTER TABLE public.ai_agent_learning_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learning metrics readable by owner or admin"
  ON public.ai_agent_learning_metrics FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id) OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_aalm_tenant ON public.ai_agent_learning_metrics (tenant_id, agent_type, created_at DESC);

-- FASE 9: impacto do aprendizado
CREATE TABLE IF NOT EXISTS public.ai_learning_impact_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  learning_id uuid,
  metric text NOT NULL,
  metric_before numeric,
  metric_after numeric,
  improvement_percentage numeric,
  sample_before integer NOT NULL DEFAULT 0,
  sample_after integer NOT NULL DEFAULT 0,
  measured_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_learning_impact_logs TO authenticated;
GRANT ALL ON public.ai_learning_impact_logs TO service_role;
ALTER TABLE public.ai_learning_impact_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learning impact readable by owner or admin"
  ON public.ai_learning_impact_logs FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id) OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_alil_tenant ON public.ai_learning_impact_logs (tenant_id, created_at DESC);

-- FASE 7: lacunas de conhecimento
CREATE TABLE IF NOT EXISTS public.ai_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  property_id uuid,
  topic text NOT NULL,
  normalized_key text NOT NULL,
  sample_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  occurrences integer NOT NULL DEFAULT 1,
  avg_confidence numeric,
  escalation_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_knowledge_gaps TO authenticated;
GRANT ALL ON public.ai_knowledge_gaps TO service_role;
ALTER TABLE public.ai_knowledge_gaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge gaps readable by owner or admin"
  ON public.ai_knowledge_gaps FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_account_member(auth.uid(), owner_id) OR public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_akg_key ON public.ai_knowledge_gaps (owner_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), normalized_key);
CREATE TRIGGER ai_knowledge_gaps_touch BEFORE UPDATE ON public.ai_knowledge_gaps
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- FASE 6: sugestões de prompt (nunca aplicadas automaticamente)
CREATE TABLE IF NOT EXISTS public.ai_prompt_change_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  prompt_key text NOT NULL,
  prompt_version text,
  current_prompt text,
  suggestion text NOT NULL,
  reason text,
  expected_impact text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_prompt_change_candidates TO authenticated;
GRANT ALL ON public.ai_prompt_change_candidates TO service_role;
ALTER TABLE public.ai_prompt_change_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prompt candidates readable by owner or admin"
  ON public.ai_prompt_change_candidates FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_apcc_tenant ON public.ai_prompt_change_candidates (tenant_id, status, created_at DESC);
CREATE TRIGGER ai_prompt_change_candidates_touch BEFORE UPDATE ON public.ai_prompt_change_candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Registro de uso de memória (alimenta FASE 8)
CREATE OR REPLACE FUNCTION public.bump_memory_usage(_ids uuid[], _outcome text DEFAULT 'neutral')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ai_memories SET
    memory_usage_count = memory_usage_count + 1,
    last_used_at = now(),
    success_count = success_count + CASE WHEN _outcome = 'success' THEN 1 ELSE 0 END,
    failure_count = failure_count + CASE WHEN _outcome = 'failure' THEN 1 ELSE 0 END
  WHERE id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.bump_memory_usage(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_memory_usage(uuid[], text) TO service_role;