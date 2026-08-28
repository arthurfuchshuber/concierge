import type { SupabaseClient } from "@supabase/supabase-js";
import { requireMemberPermission } from "@/lib/member-permissions.server";

// Resolve the owner_id of the property behind a conversation, then enforce chat_respond.
export async function requireChatRespondForConversation(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
  knownOwnerId?: string | null,
): Promise<void> {
  let ownerId = knownOwnerId;
  if (ownerId === undefined) {
    const { data: conv } = await supabase
      .from("property_chat_conversations")
      .select("property_id, properties:property_id(owner_id)")
      .eq("id", conversationId)
      .maybeSingle();
    ownerId = (conv?.properties as { owner_id?: string } | null)?.owner_id;
  }
  if (!ownerId) return; // conversa órfã: deixa a RLS decidir
  // O atendimento humano é recurso de plano pago: validamos aqui (caminho de
  // escrita) e não só na consulta de UI, senão o dono da conta contornaria o
  // bloqueio chamando a função direto.
  const { assertFeature } = await import("@/lib/plan-guard.server");
  await assertFeature(supabase, userId, "humanHandoff", { ownerId });
  await requireMemberPermission(supabase, userId, ownerId, "chat_respond");
}
