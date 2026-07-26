-- 1) host_whatsapp_config
CREATE TABLE IF NOT EXISTS public.host_whatsapp_config (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'sinch',
  service_plan_id text,
  api_token_encrypted text,
  sender_number text,
  app_id text,
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','testing','active','error')),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_whatsapp_config TO authenticated;
GRANT ALL ON public.host_whatsapp_config TO service_role;

ALTER TABLE public.host_whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own whatsapp config"
  ON public.host_whatsapp_config FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER host_whatsapp_config_touch
  BEFORE UPDATE ON public.host_whatsapp_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) whatsapp_templates
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'pt_BR',
  category text NOT NULL DEFAULT 'utility' CHECK (category IN ('welcome','checkin','checkout','alert','utility','marketing')),
  body text NOT NULL,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  sinch_template_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name, language)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner manages own whatsapp templates"
  ON public.whatsapp_templates FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (auth.uid() = owner_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS whatsapp_templates_owner_idx ON public.whatsapp_templates(owner_id);

CREATE TRIGGER whatsapp_templates_touch
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) property_chat_messages: canal, status entrega, id externo
ALTER TABLE public.property_chat_messages
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp')),
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS delivery_status text CHECK (delivery_status IN ('queued','sent','delivered','read','failed')),
  ADD COLUMN IF NOT EXISTS sent_via_number text;

CREATE UNIQUE INDEX IF NOT EXISTS property_chat_messages_external_id_uniq
  ON public.property_chat_messages(external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS property_chat_messages_channel_idx
  ON public.property_chat_messages(channel);