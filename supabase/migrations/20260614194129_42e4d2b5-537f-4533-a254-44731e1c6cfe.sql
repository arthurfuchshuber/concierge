
CREATE TABLE public.property_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_session_id text NOT NULL,
  guest_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pcc_property ON public.property_chat_conversations(property_id, last_message_at DESC);
CREATE INDEX idx_pcc_session ON public.property_chat_conversations(guest_session_id);

GRANT SELECT ON public.property_chat_conversations TO authenticated;
GRANT ALL ON public.property_chat_conversations TO service_role;
ALTER TABLE public.property_chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their property conversations"
ON public.property_chat_conversations FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id = property_chat_conversations.property_id
    AND p.owner_id = auth.uid()
));

CREATE TRIGGER trg_pcc_updated_at
BEFORE UPDATE ON public.property_chat_conversations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.property_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.property_chat_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pcm_conv ON public.property_chat_messages(conversation_id, created_at);

GRANT SELECT ON public.property_chat_messages TO authenticated;
GRANT ALL ON public.property_chat_messages TO service_role;
ALTER TABLE public.property_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view messages of their property conversations"
ON public.property_chat_messages FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.property_chat_conversations c
  JOIN public.properties p ON p.id = c.property_id
  WHERE c.id = property_chat_messages.conversation_id
    AND p.owner_id = auth.uid()
));
