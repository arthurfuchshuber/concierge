CREATE TYPE public.permission_migration_mode AS ENUM ('legacy','monitoring','enforced','completed');

CREATE TABLE public.permission_migration_status (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE,
  status public.permission_migration_mode NOT NULL DEFAULT 'legacy',
  activated_at timestamptz,
  activated_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.permission_migration_status TO authenticated;
GRANT ALL ON public.permission_migration_status TO service_role;

ALTER TABLE public.permission_migration_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins do SaaS podem ler o status de migracao"
  ON public.permission_migration_status FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_permission_migration_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_permission_migration_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_permission_migration_updated_at
BEFORE UPDATE ON public.permission_migration_status
FOR EACH ROW EXECUTE FUNCTION public.set_permission_migration_updated_at();

CREATE INDEX idx_permission_migration_status_status ON public.permission_migration_status(status);