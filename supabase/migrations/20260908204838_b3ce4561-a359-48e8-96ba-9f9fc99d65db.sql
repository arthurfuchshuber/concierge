-- ai_memories
DROP POLICY IF EXISTS "Owners and trainers manage AI memories" ON public.ai_memories;
CREATE POLICY "AI memories readable by team" ON public.ai_memories FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "AI memories writable by trainers" ON public.ai_memories FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "AI memories updatable by trainers" ON public.ai_memories FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission))
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "AI memories deletable by trainers" ON public.ai_memories FOR DELETE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));

-- ai_operational_memory
DROP POLICY IF EXISTS "Owners and trainers manage operational memory" ON public.ai_operational_memory;
CREATE POLICY "Operational memory readable by team" ON public.ai_operational_memory FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'operation_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Operational memory insert by trainers" ON public.ai_operational_memory FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Operational memory update by trainers" ON public.ai_operational_memory FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission))
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Operational memory delete by trainers" ON public.ai_operational_memory FOR DELETE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));

-- ai_human_escalations
DROP POLICY IF EXISTS "Owners and trainers manage escalations" ON public.ai_human_escalations;
CREATE POLICY "Escalations readable by team" ON public.ai_human_escalations FOR SELECT TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'ai_view'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Escalations insert by responders" ON public.ai_human_escalations FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Escalations update by responders" ON public.ai_human_escalations FOR UPDATE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission))
WITH CHECK (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));
CREATE POLICY "Escalations delete by responders" ON public.ai_human_escalations FOR DELETE TO authenticated
USING (owner_id = auth.uid() OR has_role(auth.uid(),'admin'::app_role)
  OR has_member_permission(auth.uid(), owner_id, 'ai_train'::member_permission)
  OR has_member_permission(auth.uid(), owner_id, 'chat_respond'::member_permission));

-- Stakeholders: explicit SELECT policies so Realtime change events are RLS-scoped
CREATE POLICY "Account can read owners" ON public.property_owners FOR SELECT TO authenticated
USING (can_access_stakeholder_data(auth.uid(), account_owner_id));
CREATE POLICY "Account can read providers" ON public.service_providers FOR SELECT TO authenticated
<<<<<<< HEAD
USING (can_access_stakeholder_data(auth.uid(), account_owner_id));
=======
USING (can_access_stakeholder_data(auth.uid(), account_owner_id));
>>>>>>> 5a9fa45acc4e76074b6ef365b37b3a4ffb6b674b
