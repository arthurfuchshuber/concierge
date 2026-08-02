CREATE TABLE public.stakeholder_link_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alias_kind text NOT NULL CHECK (alias_kind IN ('email','domain','doc','name')),
  alias_value text NOT NULL,
  stakeholder_type text NOT NULL CHECK (stakeholder_type IN ('owner','provider')),
  stakeholder_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_owner_id, alias_kind, alias_value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stakeholder_link_aliases TO authenticated;
GRANT ALL ON public.stakeholder_link_aliases TO service_role;

ALTER TABLE public.stakeholder_link_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Account can manage own stakeholder aliases"
ON public.stakeholder_link_aliases FOR ALL TO authenticated
USING (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id))
WITH CHECK (account_owner_id = auth.uid() OR public.is_account_member(auth.uid(), account_owner_id));

CREATE TRIGGER touch_stakeholder_link_aliases
BEFORE UPDATE ON public.stakeholder_link_aliases
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();