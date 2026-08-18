DROP POLICY IF EXISTS "Owners manage their AI memories" ON public.ai_memories;
CREATE POLICY "Owners and trainers manage AI memories"
ON public.ai_memories FOR ALL
USING (
  owner_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission)
)
WITH CHECK (
  owner_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission)
);

DROP POLICY IF EXISTS "Owners manage their operational memory" ON public.ai_operational_memory;
CREATE POLICY "Owners and trainers manage operational memory"
ON public.ai_operational_memory FOR ALL
USING (
  owner_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'operation_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission)
)
WITH CHECK (
  owner_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'operation_edit'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission)
);