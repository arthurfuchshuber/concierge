-- ENUMS
CREATE TYPE public.permission_node_type AS ENUM ('PAGE','SUBPAGE','TAB','RESOURCE','FIELD');
CREATE TYPE public.permission_access_level AS ENUM ('NONE','READ','WRITE');
CREATE TYPE public.permission_scope_type AS ENUM ('GLOBAL','TENANT','CLIENT','PROPERTY','RECORD');
CREATE TYPE public.permission_system_role AS ENUM ('OWNER','SYSTEM','ADMIN_SAAS','CRON','INTEGRATION');

-- updated_at helper (idempotent)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- 1) PERMISSION NODES (catálogo hierárquico)
CREATE TABLE public.permission_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_id uuid REFERENCES public.permission_nodes(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  type public.permission_node_type NOT NULL,
  description text,
  "order" integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_permission_nodes_parent ON public.permission_nodes(parent_id);
GRANT SELECT ON public.permission_nodes TO authenticated;
GRANT ALL ON public.permission_nodes TO service_role;
ALTER TABLE public.permission_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read permission nodes"
  ON public.permission_nodes FOR SELECT TO authenticated USING (true);
CREATE TRIGGER trg_permission_nodes_updated_at BEFORE UPDATE ON public.permission_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) PERMISSION ASSIGNMENTS
CREATE TABLE public.permission_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  permission_node_id uuid NOT NULL REFERENCES public.permission_nodes(id) ON DELETE CASCADE,
  access_level public.permission_access_level NOT NULL DEFAULT 'NONE',
  scope_type public.permission_scope_type NOT NULL DEFAULT 'TENANT',
  scope_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, permission_node_id, scope_type, scope_id)
);
CREATE INDEX idx_permission_assignments_tenant_user ON public.permission_assignments(tenant_id, user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permission_assignments TO authenticated;
GRANT ALL ON public.permission_assignments TO service_role;
ALTER TABLE public.permission_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage permission assignments"
  ON public.permission_assignments FOR ALL TO authenticated
  USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Members read their own permission assignments"
  ON public.permission_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER trg_permission_assignments_updated_at BEFORE UPDATE ON public.permission_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) PROPERTY ASSIGNMENTS
CREATE TABLE public.property_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, property_id, user_id)
);
CREATE INDEX idx_property_assignments_tenant_user ON public.property_assignments(tenant_id, user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_assignments TO authenticated;
GRANT ALL ON public.property_assignments TO service_role;
ALTER TABLE public.property_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage property assignments"
  ON public.property_assignments FOR ALL TO authenticated
  USING (tenant_id = auth.uid()) WITH CHECK (tenant_id = auth.uid());
CREATE POLICY "Members read their own property assignments"
  ON public.property_assignments FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE TRIGGER trg_property_assignments_updated_at BEFORE UPDATE ON public.property_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) PERMISSION AUDIT
CREATE TABLE public.permission_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL,
  actor_id uuid,
  actor_name text,
  target_user_id uuid,
  permission_node_id uuid REFERENCES public.permission_nodes(id) ON DELETE SET NULL,
  previous_access_level public.permission_access_level,
  new_access_level public.permission_access_level,
  scope_type public.permission_scope_type,
  scope_id uuid,
  action text NOT NULL DEFAULT 'update',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_permission_audit_tenant ON public.permission_audit(tenant_id, created_at DESC);
GRANT SELECT ON public.permission_audit TO authenticated;
GRANT ALL ON public.permission_audit TO service_role;
ALTER TABLE public.permission_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read permission audit"
  ON public.permission_audit FOR SELECT TO authenticated
  USING (tenant_id = auth.uid());