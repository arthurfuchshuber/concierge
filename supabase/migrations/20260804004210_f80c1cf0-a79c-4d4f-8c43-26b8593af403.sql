-- =========================================================
-- PHASE 1: Agent Evaluation Framework
-- =========================================================
CREATE TABLE public.ai_agent_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  suite text NOT NULL DEFAULT 'default',
  test_case_name text NOT NULL,
  input_message text NOT NULL,
  expected_agent text,
  expected_behavior text,
  expected_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  actual_agent text,
  actual_tools jsonb NOT NULL DEFAULT '[]'::jsonb,
  actual_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_response text,
  confidence_score numeric,
  reflection_score numeric,
  human_score numeric,
  accuracy_score numeric,
  quality_score numeric,
  evaluation_status text NOT NULL DEFAULT 'pending',
  regression_baseline_id uuid REFERENCES public.ai_agent_evaluations(id) ON DELETE SET NULL,
  regression_result text,
  prompt_versions jsonb,
  models jsonb,
  latency_ms integer,
  notes text,
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_evaluations TO authenticated;
GRANT ALL ON public.ai_agent_evaluations TO service_role;
ALTER TABLE public.ai_agent_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eval tenant read" ON public.ai_agent_evaluations FOR SELECT TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "eval admin write" ON public.ai_agent_evaluations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER ai_agent_evaluations_touch BEFORE UPDATE ON public.ai_agent_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX ai_agent_evaluations_tenant_idx ON public.ai_agent_evaluations(tenant_id, created_at DESC);
CREATE INDEX ai_agent_evaluations_run_idx ON public.ai_agent_evaluations(run_id);

-- =========================================================
-- PHASE 1.5: Observability metrics store
-- =========================================================
CREATE TABLE public.ai_agent_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  agent_type text NOT NULL DEFAULT 'generalist',
  metric_name text NOT NULL,
  metric_value numeric NOT NULL,
  dimension text,
  period text NOT NULL DEFAULT 'day',
  period_start timestamptz NOT NULL DEFAULT date_trunc('day', now()),
  sample_size integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_agent_metrics TO authenticated;
GRANT ALL ON public.ai_agent_metrics TO service_role;
ALTER TABLE public.ai_agent_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metrics tenant read" ON public.ai_agent_metrics FOR SELECT TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX ai_agent_metrics_unique_idx
  ON public.ai_agent_metrics(coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), agent_type, metric_name, coalesce(dimension, ''), period, period_start);
CREATE INDEX ai_agent_metrics_lookup_idx ON public.ai_agent_metrics(tenant_id, period_start DESC);

-- =========================================================
-- PHASE 2.5: Channel Gateway
-- =========================================================
CREATE TABLE public.ai_conversation_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.property_chat_conversations(id) ON DELETE CASCADE,
  tenant_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  channel_type text NOT NULL DEFAULT 'guide_chat',
  external_reference text,
  external_thread_id text,
  locale text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_conversation_channels TO authenticated;
GRANT ALL ON public.ai_conversation_channels TO service_role;
ALTER TABLE public.ai_conversation_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels tenant read" ON public.ai_conversation_channels FOR SELECT TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX ai_conversation_channels_conv_idx ON public.ai_conversation_channels(conversation_id);
CREATE INDEX ai_conversation_channels_ext_idx ON public.ai_conversation_channels(channel_type, external_reference);
CREATE TRIGGER ai_conversation_channels_touch BEFORE UPDATE ON public.ai_conversation_channels
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- PHASE 3: Proactive actions
-- =========================================================
CREATE TABLE public.ai_proactive_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  owner_id uuid,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.property_reservations(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.property_chat_conversations(id) ON DELETE SET NULL,
  guest_id text,
  guest_name text,
  trigger_event text NOT NULL,
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_key text NOT NULL,
  recommended_action text NOT NULL,
  action_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_action text,
  autonomy_level text NOT NULL DEFAULT 'high',
  status text NOT NULL DEFAULT 'pending',
  approval_status text NOT NULL DEFAULT 'not_required',
  approved_by uuid,
  approved_at timestamptz,
  executed_at timestamptz,
  scheduled_for timestamptz,
  dedupe_key text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.ai_proactive_actions TO authenticated;
GRANT ALL ON public.ai_proactive_actions TO service_role;
ALTER TABLE public.ai_proactive_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proactive tenant read" ON public.ai_proactive_actions FOR SELECT TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "proactive tenant update" ON public.ai_proactive_actions FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX ai_proactive_actions_dedupe_idx ON public.ai_proactive_actions(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX ai_proactive_actions_status_idx ON public.ai_proactive_actions(tenant_id, status, created_at DESC);
CREATE TRIGGER ai_proactive_actions_touch BEFORE UPDATE ON public.ai_proactive_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- PHASE 2: Tenant isolation columns
-- =========================================================
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.ai_memories ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.ai_operational_memory ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.ai_human_escalations ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.ai_learning_candidates ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.ai_kb_chunks ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE public.ai_agent_logs SET tenant_id = owner_id WHERE tenant_id IS NULL;
UPDATE public.ai_memories SET tenant_id = owner_id WHERE tenant_id IS NULL;
UPDATE public.ai_operational_memory SET tenant_id = owner_id WHERE tenant_id IS NULL;
UPDATE public.ai_human_escalations SET tenant_id = owner_id WHERE tenant_id IS NULL;
UPDATE public.ai_learning_candidates SET tenant_id = owner_id WHERE tenant_id IS NULL;
UPDATE public.ai_kb_chunks SET tenant_id = owner_id WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS ai_agent_logs_tenant_idx ON public.ai_agent_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_memories_tenant_idx ON public.ai_memories(tenant_id);
CREATE INDEX IF NOT EXISTS ai_operational_memory_tenant_idx ON public.ai_operational_memory(tenant_id);
CREATE INDEX IF NOT EXISTS ai_human_escalations_tenant_idx ON public.ai_human_escalations(tenant_id);
CREATE INDEX IF NOT EXISTS ai_learning_candidates_tenant_idx ON public.ai_learning_candidates(tenant_id);
CREATE INDEX IF NOT EXISTS ai_kb_chunks_tenant_idx ON public.ai_kb_chunks(tenant_id);

-- =========================================================
-- AUDITORIA FINAL: expansão de ai_agent_logs
-- =========================================================
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS evaluation_score numeric;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS regression_test_result text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS channel_origin text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS channel_reference text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS proactive_trigger text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS autonomy_level text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS action_approval_status text;
ALTER TABLE public.ai_agent_logs ADD COLUMN IF NOT EXISTS root_cause jsonb;