-- ============ Human-in-the-loop: escalonamentos ============
CREATE TABLE public.ai_human_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  conversation_id uuid,
  guest_key text,
  guest_name text,
  agent_type text NOT NULL DEFAULT 'supervisor',
  reason text NOT NULL,
  trigger text NOT NULL DEFAULT 'low_confidence',
  confidence_score numeric,
  question_to_human text NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_response text,
  human_user_id uuid,
  status text NOT NULL DEFAULT 'open',
  applied_to_guest boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_human_escalations TO authenticated;
GRANT ALL ON public.ai_human_escalations TO service_role;

ALTER TABLE public.ai_human_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and trainers manage escalations"
  ON public.ai_human_escalations FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_member_permission(auth.uid(), owner_id, 'ai_train')
    OR public.has_member_permission(auth.uid(), owner_id, 'chat_respond')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_member_permission(auth.uid(), owner_id, 'ai_train')
    OR public.has_member_permission(auth.uid(), owner_id, 'chat_respond')
  );

CREATE INDEX ai_human_escalations_owner_status_idx
  ON public.ai_human_escalations (owner_id, status, created_at DESC);
CREATE INDEX ai_human_escalations_conversation_idx
  ON public.ai_human_escalations (conversation_id, created_at DESC);

CREATE TRIGGER ai_human_escalations_updated_at
  BEFORE UPDATE ON public.ai_human_escalations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Learning loop: candidatos de aprendizado ============
CREATE TABLE public.ai_learning_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  source_escalation_id uuid REFERENCES public.ai_human_escalations(id) ON DELETE CASCADE,
  agent_type text,
  proposed_memory text NOT NULL,
  title text,
  category text,
  memory_kind text NOT NULL DEFAULT 'operational_rule',
  confidence numeric NOT NULL DEFAULT 0.7,
  recommended_scope text NOT NULL DEFAULT 'property',
  approved_scope text,
  rationale text,
  ttl_days integer,
  approval_status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_memory_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_learning_candidates TO authenticated;
GRANT ALL ON public.ai_learning_candidates TO service_role;

ALTER TABLE public.ai_learning_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners and trainers manage learning candidates"
  ON public.ai_learning_candidates FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_member_permission(auth.uid(), owner_id, 'ai_train')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_member_permission(auth.uid(), owner_id, 'ai_train')
  );

CREATE INDEX ai_learning_candidates_owner_status_idx
  ON public.ai_learning_candidates (owner_id, approval_status, created_at DESC);

CREATE TRIGGER ai_learning_candidates_updated_at
  BEFORE UPDATE ON public.ai_learning_candidates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Memórias: origem e autoria ============
ALTER TABLE public.ai_memories
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- ============ Auditoria multi-agente ============
ALTER TABLE public.ai_agent_logs
  ADD COLUMN IF NOT EXISTS selected_agent text,
  ADD COLUMN IF NOT EXISTS orchestrator_decision jsonb,
  ADD COLUMN IF NOT EXISTS escalation_triggered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalation_id uuid,
  ADD COLUMN IF NOT EXISTS human_response_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_created boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS memory_saved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS memory_scope text;