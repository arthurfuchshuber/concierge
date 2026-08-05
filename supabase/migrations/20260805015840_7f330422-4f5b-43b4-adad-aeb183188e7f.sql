CREATE OR REPLACE FUNCTION public.replace_permission_assignment(
  _tenant_id uuid,
  _user_id uuid,
  _permission_node_id uuid,
  _access_level public.permission_access_level,
  _scope_type public.permission_scope_type,
  _scope_id uuid DEFAULT NULL,
  _created_by uuid DEFAULT NULL
)
RETURNS public.permission_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result public.permission_assignments;
  _lock_key bigint;
BEGIN
  _lock_key := hashtextextended(
    concat_ws(':', _tenant_id::text, _user_id::text, _permission_node_id::text, _scope_type::text, coalesce(_scope_id::text, 'NULL')),
    0
  );
  PERFORM pg_advisory_xact_lock(_lock_key);

  DELETE FROM public.permission_assignments
  WHERE tenant_id = _tenant_id
    AND user_id = _user_id
    AND permission_node_id = _permission_node_id
    AND scope_type = _scope_type
    AND scope_id IS NOT DISTINCT FROM _scope_id;

  INSERT INTO public.permission_assignments (
    tenant_id, user_id, permission_node_id, access_level, scope_type, scope_id, created_by
  ) VALUES (
    _tenant_id, _user_id, _permission_node_id, _access_level, _scope_type, _scope_id, _created_by
  )
  RETURNING * INTO _result;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_permission_assignment(uuid, uuid, uuid, public.permission_access_level, public.permission_scope_type, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_permission_assignment(uuid, uuid, uuid, public.permission_access_level, public.permission_scope_type, uuid, uuid) TO service_role;