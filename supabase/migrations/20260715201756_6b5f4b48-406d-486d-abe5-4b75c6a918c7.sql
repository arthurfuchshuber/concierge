
-- ============================================================
-- 1. Tipos
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.account_member_role AS ENUM ('owner', 'agent', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.account_member_status AS ENUM ('pending', 'active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_conversation_status AS ENUM ('ai', 'needs_human', 'assigned', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_sender_type AS ENUM ('guest', 'ai', 'human', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. account_members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.account_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.account_member_role NOT NULL DEFAULT 'agent',
  status public.account_member_status NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_members_owner ON public.account_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_account_members_member ON public.account_members(member_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_members TO authenticated;
GRANT ALL ON public.account_members TO service_role;
ALTER TABLE public.account_members ENABLE ROW LEVEL SECURITY;

INSERT INTO public.account_members (owner_id, member_user_id, role, status)
SELECT DISTINCT p.owner_id, p.owner_id, 'owner'::public.account_member_role, 'active'::public.account_member_status
FROM public.properties p
WHERE p.owner_id IS NOT NULL
ON CONFLICT (owner_id, member_user_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_account_members_touch ON public.account_members;
CREATE TRIGGER trg_account_members_touch
BEFORE UPDATE ON public.account_members
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 3. Helpers de autorização
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_account_member(_user_id uuid, _owner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE member_user_id = _user_id
      AND owner_id = _owner_id
      AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.account_member_role_of(_user_id uuid, _owner_id uuid)
RETURNS public.account_member_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.account_members
  WHERE member_user_id = _user_id AND owner_id = _owner_id AND status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_property(_user_id uuid, _property_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = _property_id
      AND (
        p.owner_id = _user_id
        OR public.is_account_member(_user_id, p.owner_id)
      )
  );
$$;

-- ============================================================
-- 4. Policies em account_members
-- ============================================================
DROP POLICY IF EXISTS "Members can view their memberships" ON public.account_members;
CREATE POLICY "Members can view their memberships"
ON public.account_members FOR SELECT
TO authenticated
USING (
  member_user_id = auth.uid()
  OR owner_id = auth.uid()
);

DROP POLICY IF EXISTS "Owners manage their members" ON public.account_members;
CREATE POLICY "Owners manage their members"
ON public.account_members FOR ALL
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

-- ============================================================
-- 5. account_member_invites
-- ============================================================
CREATE TABLE IF NOT EXISTS public.account_member_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.account_member_role NOT NULL DEFAULT 'agent',
  status text NOT NULL DEFAULT 'pending',
  invited_by uuid REFERENCES auth.users(id),
  accepted_user_id uuid REFERENCES auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_invites_pending_unique
  ON public.account_member_invites (owner_id, lower(email))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_account_invites_email ON public.account_member_invites(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_member_invites TO authenticated;
GRANT ALL ON public.account_member_invites TO service_role;
ALTER TABLE public.account_member_invites ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_account_invites_touch ON public.account_member_invites;
CREATE TRIGGER trg_account_invites_touch
BEFORE UPDATE ON public.account_member_invites
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP POLICY IF EXISTS "Owners manage invites" ON public.account_member_invites;
CREATE POLICY "Owners manage invites"
ON public.account_member_invites FOR ALL
TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Invitee can view own invite" ON public.account_member_invites;
CREATE POLICY "Invitee can view own invite"
ON public.account_member_invites FOR SELECT
TO authenticated
USING (
  status = 'pending'
  AND lower(email) = lower(COALESCE((auth.jwt() ->> 'email')::text, ''))
);

-- ============================================================
-- 6. Aceite automático de convite no signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_account_invite_on_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  FOR inv IN
    SELECT * FROM public.account_member_invites
    WHERE lower(email) = lower(NEW.email)
      AND status = 'pending'
      AND expires_at > now()
  LOOP
    INSERT INTO public.account_members (owner_id, member_user_id, role, status, invited_by)
    VALUES (inv.owner_id, NEW.id, inv.role, 'active'::public.account_member_status, inv.invited_by)
    ON CONFLICT (owner_id, member_user_id) DO UPDATE
      SET role = EXCLUDED.role, status = 'active'::public.account_member_status, updated_at = now();

    UPDATE public.account_member_invites
      SET status = 'accepted', accepted_user_id = NEW.id, accepted_at = now(), updated_at = now()
      WHERE id = inv.id;

    INSERT INTO public.audit_logs (user_id, user_email, action, entity_type, entity_id, metadata)
    VALUES (NEW.id, NEW.email, 'account_invite.accepted', 'account_member_invites', inv.id::text,
      jsonb_build_object('owner_id', inv.owner_id, 'role', inv.role));
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_accept_account_invite ON auth.users;
CREATE TRIGGER on_auth_user_created_accept_account_invite
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.accept_account_invite_on_signup();

-- ============================================================
-- 7. push_subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  enabled boolean NOT NULL DEFAULT true,
  sound_enabled boolean NOT NULL DEFAULT true,
  quiet_hours_start smallint,
  quiet_hours_end smallint,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id) WHERE enabled;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_push_subs_touch ON public.push_subscriptions;
CREATE TRIGGER trg_push_subs_touch
BEFORE UPDATE ON public.push_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP POLICY IF EXISTS "Users manage own push subs" ON public.push_subscriptions;
CREATE POLICY "Users manage own push subs"
ON public.push_subscriptions FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 8. Colunas novas em property_chat_conversations
-- ============================================================
ALTER TABLE public.property_chat_conversations
  ADD COLUMN IF NOT EXISTS status public.chat_conversation_status NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS handoff_reason text,
  ADD COLUMN IF NOT EXISTS handoff_urgency text,
  ADD COLUMN IF NOT EXISTS handoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS ai_paused boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_conv_status ON public.property_chat_conversations(status);
CREATE INDEX IF NOT EXISTS idx_chat_conv_property_last ON public.property_chat_conversations(property_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conv_assigned ON public.property_chat_conversations(assigned_to) WHERE assigned_to IS NOT NULL;

-- ============================================================
-- 9. Colunas novas em property_chat_messages
-- ============================================================
ALTER TABLE public.property_chat_messages
  ADD COLUMN IF NOT EXISTS sender_type public.chat_sender_type NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS sender_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS is_internal_note boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON public.property_chat_messages(conversation_id, created_at);

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.property_chat_conversations
    SET last_message_at = COALESCE(NEW.created_at, now())
    WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_msg_update_conv ON public.property_chat_messages;
CREATE TRIGGER trg_chat_msg_update_conv
AFTER INSERT ON public.property_chat_messages
FOR EACH ROW
WHEN (NEW.is_internal_note = false)
EXECUTE FUNCTION public.update_conversation_last_message();

-- ============================================================
-- 10. Policies em conversas/mensagens para membros da conta
-- ============================================================
DROP POLICY IF EXISTS "Account members can view conversations" ON public.property_chat_conversations;
CREATE POLICY "Account members can view conversations"
ON public.property_chat_conversations FOR SELECT
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "Account members can update conversations" ON public.property_chat_conversations;
CREATE POLICY "Account members can update conversations"
ON public.property_chat_conversations FOR UPDATE
TO authenticated
USING (public.user_can_access_property(auth.uid(), property_id))
WITH CHECK (public.user_can_access_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "Account members can view messages" ON public.property_chat_messages;
CREATE POLICY "Account members can view messages"
ON public.property_chat_messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.property_chat_conversations c
    WHERE c.id = property_chat_messages.conversation_id
      AND public.user_can_access_property(auth.uid(), c.property_id)
  )
);

DROP POLICY IF EXISTS "Account members can insert messages" ON public.property_chat_messages;
CREATE POLICY "Account members can insert messages"
ON public.property_chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.property_chat_conversations c
    WHERE c.id = property_chat_messages.conversation_id
      AND public.user_can_access_property(auth.uid(), c.property_id)
  )
);

-- ============================================================
-- 11. Realtime
-- ============================================================
ALTER TABLE public.property_chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.property_chat_messages REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.property_chat_conversations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.property_chat_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
