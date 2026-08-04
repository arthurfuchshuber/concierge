-- 1) Campos adicionais em permission_nodes (soft delete / governança)
ALTER TABLE public.permission_nodes
  ADD COLUMN IF NOT EXISTS is_permissionable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS feature text,
  ADD COLUMN IF NOT EXISTS max_access_level public.permission_access_level NOT NULL DEFAULT 'WRITE',
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- 2) Histórico de renomeação de slugs
CREATE TABLE IF NOT EXISTS public.permission_node_slug_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_slug text NOT NULL,
  new_slug text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (old_slug, new_slug)
);

GRANT SELECT ON public.permission_node_slug_history TO authenticated;
GRANT ALL ON public.permission_node_slug_history TO service_role;

ALTER TABLE public.permission_node_slug_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SaaS admins read slug history"
  ON public.permission_node_slug_history FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 3) Execuções de sincronização do registry
CREATE TABLE IF NOT EXISTS public.permission_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  total_nodes integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  deactivated_count integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.permission_sync_runs TO authenticated;
GRANT ALL ON public.permission_sync_runs TO service_role;

ALTER TABLE public.permission_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SaaS admins read sync runs"
  ON public.permission_sync_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) RLS de permission_nodes — não expor o mapa completo a membros comuns
DROP POLICY IF EXISTS "Authenticated can read permission nodes" ON public.permission_nodes;

CREATE POLICY "Admins and account owners read permission nodes"
  ON public.permission_nodes FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR NOT EXISTS (
      SELECT 1 FROM public.account_members am
      WHERE am.member_user_id = auth.uid()
        AND am.status = 'active'
        AND am.owner_id <> auth.uid()
    )
  );

-- 5) Vínculo usuário ↔ imóvel sem duplicidade
CREATE UNIQUE INDEX IF NOT EXISTS property_assignments_unique_link
  ON public.property_assignments (tenant_id, property_id, user_id);