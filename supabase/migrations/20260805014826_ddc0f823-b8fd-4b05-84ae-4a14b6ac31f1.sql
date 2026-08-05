DELETE FROM public.permission_assignments a
USING public.permission_assignments b
WHERE a.tenant_id = b.tenant_id
  AND a.user_id = b.user_id
  AND a.permission_node_id = b.permission_node_id
  AND a.scope_type = b.scope_type
  AND a.scope_id IS NOT DISTINCT FROM b.scope_id
  AND (a.created_at, a.id) < (b.created_at, b.id);

CREATE UNIQUE INDEX IF NOT EXISTS permission_assignments_unique_scope_null
  ON public.permission_assignments (tenant_id, user_id, permission_node_id, scope_type)
  WHERE scope_id IS NULL;