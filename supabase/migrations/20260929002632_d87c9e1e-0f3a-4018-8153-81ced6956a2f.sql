DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_member_invites','account_member_permissions','account_members','ai_agent_logs','ai_conversation_summaries','ai_guest_memory','ai_kb_chunks','chat_message_feedback','clicksign_documents','guest_arrival_status','guide_access_logs','guide_section_events','host_behavior','host_faqs','host_knowledge','ops_push_log','permission_assignments','permission_audit','permission_nodes','property_assignments','property_chat_conversations','property_chat_messages','property_daily_tips','property_details','property_owners','property_providers','property_reservations','property_slug_history','property_types','provider_categories','reservation_records','service_providers','stakeholder_activities','stakeholder_events','stakeholder_link_aliases','task_completions','tasks']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "SaaS admin reads all" ON public.%I', t);
    EXECUTE format('CREATE POLICY "SaaS admin reads all" ON public.%I FOR SELECT TO authenticated USING (public.has_role(auth.uid(), ''admin''::app_role))', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
