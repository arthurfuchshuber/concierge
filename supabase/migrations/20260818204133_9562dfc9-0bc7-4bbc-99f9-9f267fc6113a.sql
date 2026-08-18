DROP POLICY IF EXISTS "Owners and trainers manage AI memories" ON public.ai_memories;
CREATE POLICY "Owners and trainers manage AI memories" ON public.ai_memories FOR ALL TO authenticated
USING ((owner_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission))
WITH CHECK ((owner_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));

DROP POLICY IF EXISTS "Owners and trainers manage operational memory" ON public.ai_operational_memory;
CREATE POLICY "Owners and trainers manage operational memory" ON public.ai_operational_memory FOR ALL TO authenticated
USING ((owner_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'operation_view'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission))
WITH CHECK ((owner_id = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'operation_edit'::member_permission) OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));

REVOKE ALL ON public.ai_memories FROM anon;
REVOKE ALL ON public.ai_operational_memory FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_memories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_operational_memory TO authenticated;
GRANT ALL ON public.ai_memories TO service_role;
GRANT ALL ON public.ai_operational_memory TO service_role;