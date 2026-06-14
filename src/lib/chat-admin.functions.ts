import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listPropertyConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string }) => z.object({ propertyId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prop = await supabase.from("properties").select("id,name,owner_id").eq("id", data.propertyId).single();
    if (prop.error || !prop.data || prop.data.owner_id !== userId) throw new Error("Não autorizado");
    const { data: convs, error } = await supabase
      .from("property_chat_conversations")
      .select("id,guest_name,guest_session_id,created_at,last_message_at")
      .eq("property_id", data.propertyId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { property: { id: prop.data.id, name: prop.data.name }, conversations: convs ?? [] };
  });

export const getConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { conversationId: string }) => z.object({ conversationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const conv = await supabase
      .from("property_chat_conversations")
      .select("id,property_id,guest_name,guest_session_id,created_at,last_message_at,properties!inner(owner_id,name)")
      .eq("id", data.conversationId)
      .single();
    if (conv.error || !conv.data) throw new Error("Conversa não encontrada");
    // @ts-expect-error nested join
    if (conv.data.properties.owner_id !== userId) throw new Error("Não autorizado");
    const { data: msgs, error } = await supabase
      .from("property_chat_messages")
      .select("id,role,content,created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      conversation: {
        id: conv.data.id,
        guest_name: conv.data.guest_name,
        guest_session_id: conv.data.guest_session_id,
        created_at: conv.data.created_at,
        last_message_at: conv.data.last_message_at,
        // @ts-expect-error nested
        property_name: conv.data.properties.name,
        property_id: conv.data.property_id,
      },
      messages: msgs ?? [],
    };
  });
