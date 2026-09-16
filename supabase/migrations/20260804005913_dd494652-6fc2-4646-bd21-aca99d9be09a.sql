
-- ============ Conversation Core ============
CREATE TABLE public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  guest_id text,
  guest_name text,
  guest_phone text,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  reservation_id uuid,
  legacy_conversation_id uuid REFERENCES public.property_chat_conversations(id) ON DELETE SET NULL,
  channel_origin text NOT NULL DEFAULT 'platform_chat',
  status text NOT NULL DEFAULT 'open',
  assigned_agent text,
  assigned_user_id uuid,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_tenant_idx ON public.ai_conversations(tenant_id, last_message_at DESC);
CREATE INDEX ai_conversations_property_idx ON public.ai_conversations(property_id);
CREATE INDEX ai_conversations_guest_idx ON public.ai_conversations(tenant_id, guest_id);
CREATE UNIQUE INDEX ai_conversations_legacy_uidx ON public.ai_conversations(legacy_conversation_id) WHERE legacy_conversation_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO authenticated;
GRANT ALL ON public.ai_conversations TO service_role;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant manages own conversations" ON public.ai_conversations
  FOR ALL TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id))
  WITH CHECK (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id));
CREATE POLICY "Admins read conversations" ON public.ai_conversations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_conversations_touch BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Unified Message Store ============
CREATE TABLE public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  property_id uuid,
  sender_type text NOT NULL CHECK (sender_type IN ('guest','agent','human_operator','system')),
  channel_origin text NOT NULL DEFAULT 'platform_chat',
  message_content text NOT NULL,
  agent_key text,
  external_id text,
  delivery_status text,
  confidence numeric,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON public.ai_messages(conversation_id, created_at);
CREATE INDEX ai_messages_tenant_idx ON public.ai_messages(tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_messages TO authenticated;
GRANT ALL ON public.ai_messages TO service_role;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant manages own messages" ON public.ai_messages
  FOR ALL TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id))
  WITH CHECK (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id));
CREATE POLICY "Admins read messages" ON public.ai_messages
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Channel Connection Registry ============
CREATE TABLE public.ai_channel_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  channel_type text NOT NULL,
  provider text NOT NULL,
  credentials_reference text,
  external_identity text,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  connected_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_channel_connections TO authenticated;
GRANT ALL ON public.ai_channel_connections TO service_role;
ALTER TABLE public.ai_channel_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant manages own channels" ON public.ai_channel_connections
  FOR ALL TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Admins read channels" ON public.ai_channel_connections
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_channel_connections_touch BEFORE UPDATE ON public.ai_channel_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ Intelligent Alerts ============
CREATE TABLE public.ai_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  property_id uuid,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  detail text,
  metric_value numeric,
  baseline_value numeric,
  status text NOT NULL DEFAULT 'open',
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_alerts_tenant_idx ON public.ai_alerts(tenant_id, created_at DESC);
CREATE INDEX ai_alerts_status_idx ON public.ai_alerts(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_alerts TO authenticated;
GRANT ALL ON public.ai_alerts TO service_role;
ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant reads own alerts" ON public.ai_alerts
  FOR SELECT TO authenticated
  USING (tenant_id = auth.uid() OR public.is_account_member(auth.uid(), tenant_id));
CREATE POLICY "Tenant updates own alerts" ON public.ai_alerts
  FOR UPDATE TO authenticated
  USING (tenant_id = auth.uid())
  WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Admins manage alerts" ON public.ai_alerts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER ai_alerts_touch BEFORE UPDATE ON public.ai_alerts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
