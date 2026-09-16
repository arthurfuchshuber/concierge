
CREATE TABLE public.guest_push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guest_session_id TEXT NOT NULL,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.property_chat_conversations(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX guest_push_by_conversation ON public.guest_push_subscriptions(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX guest_push_by_session ON public.guest_push_subscriptions(guest_session_id, property_id);

GRANT ALL ON public.guest_push_subscriptions TO service_role;
ALTER TABLE public.guest_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Sem policies para anon/authenticated: apenas service_role (via rota pública controlada) grava/lê.

CREATE TRIGGER touch_guest_push_updated_at
  BEFORE UPDATE ON public.guest_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
