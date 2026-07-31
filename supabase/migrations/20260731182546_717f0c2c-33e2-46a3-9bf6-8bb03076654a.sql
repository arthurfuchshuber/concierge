ALTER TABLE public.property_chat_messages ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE POLICY "Account members can update messages"
ON public.property_chat_messages FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM property_chat_conversations c WHERE c.id = property_chat_messages.conversation_id AND user_can_access_property(auth.uid(), c.property_id)))
WITH CHECK (EXISTS (SELECT 1 FROM property_chat_conversations c WHERE c.id = property_chat_messages.conversation_id AND user_can_access_property(auth.uid(), c.property_id)));

CREATE POLICY "Account members can delete messages"
ON public.property_chat_messages FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM property_chat_conversations c WHERE c.id = property_chat_messages.conversation_id AND user_can_access_property(auth.uid(), c.property_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_chat_messages TO authenticated;
GRANT ALL ON public.property_chat_messages TO service_role;