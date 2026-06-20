-- New behavior knowledge base (separate from host_knowledge facts)
CREATE TABLE public.host_behavior (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual',
  source_property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_behavior TO authenticated;
GRANT ALL ON public.host_behavior TO service_role;
GRANT SELECT ON public.host_behavior TO anon;

ALTER TABLE public.host_behavior ENABLE ROW LEVEL SECURITY;

CREATE POLICY "host_behavior owner all" ON public.host_behavior
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "host_behavior public read enabled" ON public.host_behavior
  FOR SELECT TO anon
  USING (enabled = true);

CREATE INDEX host_behavior_owner_idx ON public.host_behavior(owner_id, position);

CREATE TRIGGER host_behavior_touch
  BEFORE UPDATE ON public.host_behavior
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Feedback on AI chat messages
CREATE TABLE public.chat_message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.property_chat_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.property_chat_conversations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  resolved boolean NOT NULL DEFAULT false,
  behavior_id uuid REFERENCES public.host_behavior(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_message_feedback TO authenticated;
GRANT ALL ON public.chat_message_feedback TO service_role;

ALTER TABLE public.chat_message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_feedback owner all" ON public.chat_message_feedback
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX chat_feedback_owner_idx ON public.chat_message_feedback(owner_id, created_at DESC);
CREATE INDEX chat_feedback_property_idx ON public.chat_message_feedback(property_id);

CREATE TRIGGER chat_feedback_touch
  BEFORE UPDATE ON public.chat_message_feedback
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();