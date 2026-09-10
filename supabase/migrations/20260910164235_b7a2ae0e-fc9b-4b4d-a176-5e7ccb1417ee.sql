-- Segredos de webhook e tokens cifrados deixam de ser legíveis via API pelo dono da conta.
REVOKE SELECT ON public.host_whatsapp_config FROM authenticated;
REVOKE SELECT ON public.host_integration_credentials FROM authenticated;

GRANT SELECT (owner_id, provider, service_plan_id, sender_number, app_id, status, last_verified_at, last_error, created_at, updated_at)
  ON public.host_whatsapp_config TO authenticated;

GRANT SELECT (owner_id, provider, environment, status, last_verified_at, last_error, last_sync_at, created_at, updated_at, webhook_last_event_at)
  ON public.host_integration_credentials TO authenticated;

GRANT ALL ON public.host_whatsapp_config TO service_role;
GRANT ALL ON public.host_integration_credentials TO service_role;