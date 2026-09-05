ALTER TABLE public.account_members
  ADD COLUMN IF NOT EXISTS all_properties boolean NOT NULL DEFAULT true;

-- Quem já tinha uma lista específica de residências permanece limitado.
UPDATE public.account_members m
SET all_properties = false
WHERE EXISTS (
  SELECT 1 FROM public.property_assignments a
  WHERE a.tenant_id = m.owner_id AND a.user_id = m.member_user_id
)
OR EXISTS (
  SELECT 1 FROM public.service_providers sp
  WHERE sp.member_user_id = m.member_user_id
);