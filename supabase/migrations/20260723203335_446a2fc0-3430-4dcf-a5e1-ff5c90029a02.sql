
-- Permissions catalog (enum)
DO $$ BEGIN
  CREATE TYPE public.member_permission AS ENUM (
    'chat_respond',
    'ai_train',
    'library_edit',
    'clients_manage',
    'trial_manage',
    'pricing_override'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants matrix: owner_id x member_user_id x permission
CREATE TABLE IF NOT EXISTS public.account_member_permissions (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission public.member_permission NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (owner_id, member_user_id, permission)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_member_permissions TO authenticated;
GRANT ALL ON public.account_member_permissions TO service_role;

ALTER TABLE public.account_member_permissions ENABLE ROW LEVEL SECURITY;

-- Owner manages full matrix; members can read their own row
CREATE POLICY "Owner manages permissions"
  ON public.account_member_permissions
  FOR ALL
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Member reads own permissions"
  ON public.account_member_permissions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = member_user_id);

-- Security-definer check used by guards. Owner ALWAYS bypasses.
-- Operational permissions default to TRUE when absent; administrative default FALSE.
CREATE OR REPLACE FUNCTION public.has_member_permission(
  _user_id uuid,
  _owner_id uuid,
  _permission public.member_permission
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.account_member_permissions%ROWTYPE;
  v_default boolean;
BEGIN
  IF _user_id IS NULL OR _owner_id IS NULL THEN RETURN false; END IF;
  IF _user_id = _owner_id THEN RETURN true; END IF;
  IF NOT public.is_account_member(_user_id, _owner_id) THEN RETURN false; END IF;

  SELECT * INTO v_row FROM public.account_member_permissions
    WHERE owner_id = _owner_id AND member_user_id = _user_id AND permission = _permission;

  IF FOUND THEN RETURN v_row.granted; END IF;

  v_default := CASE _permission
    WHEN 'chat_respond'    THEN true
    WHEN 'ai_train'        THEN true
    WHEN 'library_edit'    THEN true
    WHEN 'clients_manage'  THEN false
    WHEN 'trial_manage'    THEN false
    WHEN 'pricing_override' THEN false
  END;
  RETURN v_default;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_member_permission(uuid, uuid, public.member_permission) TO authenticated, service_role;
