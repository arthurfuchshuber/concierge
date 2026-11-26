/**
 * SUGESTÃO "PARECE UMA SITUAÇÃO DA REGIÃO" (mockup REG-D01/M01, 23/11/2026). Depois que a equipe fala com o
 * hóspede, a IA lê a fala: se ela afirma um problema da região (e não do imóvel), grava uma SUGESTÃO presa à
 * mensagem; a tela mostra o cartão logo abaixo dela com "Marcar Situação Regional" e "Agora Não". Nada vale para
 * outros hóspedes antes de a equipe confirmar. Segundo plano, melhor esforço: nunca lança, nunca atrasa o envio.
 */
import { cityKey } from "@/lib/city-key";

export async function suggestRegionalFromTeamMessage(p: { conversationId: string; messageId: string | null; text: string }): Promise<void> {
  try {
    if (!p.text || p.text.trim().length < 12) return;
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { data: conv } = await db
      .from("property_chat_conversations")
      .select("id, properties:property_id(owner_id, city)")
      .eq("id", p.conversationId)
      .maybeSingle();
    const prop = (Array.isArray(conv?.properties) ? conv?.properties[0] : conv?.properties) as { owner_id?: string | null; city?: string | null } | null;
    if (!prop?.owner_id || !prop.city) return;
    // já há situação ativa na cidade ou sugestão aberta nesta conversa: nada a sugerir
    const now = new Date().toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyDb = db as any;
    const { data: open, error } = await anyDb
      .from("guest_ai_regional_situations")
      .select("id, city, status, expires_at, source_conversation_id")
      .eq("owner_id", prop.owner_id)
      .in("status", ["active", "suggested"])
      .limit(50);
    if (error) return; // tabela ausente
    const key = cityKey(prop.city);
    for (const r of (open ?? []) as Array<Record<string, unknown>>) {
      if (r.status === "active" && cityKey(String(r.city)) === key && (!r.expires_at || String(r.expires_at) > now)) return;
      if (r.status === "suggested" && r.source_conversation_id === p.conversationId) return;
    }
    const { data: guestMsgs } = await db
      .from("property_chat_messages")
      .select("content")
      .eq("conversation_id", p.conversationId)
      .eq("sender_type", "guest")
      .order("created_at", { ascending: false })
      .limit(4);
    const guestContext = ((guestMsgs ?? []) as Array<{ content?: string | null }>).map((m) => String(m.content ?? "")).reverse().join("\n");
    const { classifyRegional } = await import("@/lib/atendimento-ai.server");
    const guess = await classifyRegional({ teamText: p.text, guestContext, city: prop.city });
    if (!guess) return;
    await anyDb.from("guest_ai_regional_situations").insert({
      owner_id: prop.owner_id,
      city: prop.city,
      kind: guess.kind,
      ai_text: guess.aiText,
      status: "suggested",
      source_conversation_id: p.conversationId,
      source_message_id: p.messageId,
    });
  } catch {
    /* melhor esforço */
  }
}
