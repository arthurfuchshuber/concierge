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
    const c = conv.data as unknown as {
      id: string; property_id: string; guest_name: string | null; guest_session_id: string;
      created_at: string; last_message_at: string; properties: { owner_id: string; name: string };
    };
    if (c.properties.owner_id !== userId) throw new Error("Não autorizado");
    const { data: msgs, error } = await supabase
      .from("property_chat_messages")
      .select("id,role,content,created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      conversation: {
        id: c.id,
        guest_name: c.guest_name,
        guest_session_id: c.guest_session_id,
        created_at: c.created_at,
        last_message_at: c.last_message_at,
        property_name: c.properties.name,
        property_id: c.property_id,
      },
      messages: msgs ?? [],
    };
  });
