CREATE OR REPLACE FUNCTION public.has_member_permission(_user_id uuid, _owner_id uuid, _permission member_permission)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.account_member_permissions%ROWTYPE;
BEGIN
  IF _user_id IS NULL OR _owner_id IS NULL THEN RETURN false; END IF;
  IF _user_id = _owner_id THEN RETURN true; END IF;
  IF NOT public.is_account_member(_user_id, _owner_id) THEN RETURN false; END IF;

  SELECT * INTO v_row FROM public.account_member_permissions
    WHERE owner_id = _owner_id AND member_user_id = _user_id AND permission = _permission;

  IF FOUND THEN RETURN COALESCE(v_row.granted, false); END IF;

  -- Deny por padrão: nenhuma permissão é herdada sem concessão explícita.
  RETURN false;
END;
$function$;

CREATE INDEX IF NOT EXISTS idx_property_manual_items_property_id ON public.property_manual_items(property_id);
CREATE INDEX IF NOT EXISTS idx_property_emergency_contacts_property_id ON public.property_emergency_contacts(property_id);
CREATE INDEX IF NOT EXISTS idx_property_faqs_property_id ON public.property_faqs(property_id);
CREATE INDEX IF NOT EXISTS idx_property_checkout_items_property_id ON public.property_checkout_items(property_id);
CREATE INDEX IF NOT EXISTS idx_clicksign_documents_property_id ON public.clicksign_documents(property_id);
CREATE INDEX IF NOT EXISTS idx_host_behavior_source_property_id ON public.host_behavior(source_property_id);
CREATE INDEX IF NOT EXISTS idx_chat_message_feedback_conversation_id ON public.chat_message_feedback(conversation_id);
CREATE INDEX IF NOT EXISTS idx_property_chat_messages_sender_user_id ON public.property_chat_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_channels_property_id ON public.ai_conversation_channels(property_id);
CREATE INDEX IF NOT EXISTS idx_guest_push_subscriptions_property_id ON public.guest_push_subscriptions(property_id);
CREATE INDEX IF NOT EXISTS idx_ai_proactive_actions_property_id ON public.ai_proactive_actions(property_id);
CREATE INDEX IF NOT EXISTS idx_city_reference_groups_created_by ON public.city_reference_groups(created_by);
CREATE INDEX IF NOT EXISTS idx_admin_invites_invited_by ON public.admin_invites(invited_by);