// Helper server-only: envia push para o hóspede de uma conversa.
// Importar somente dentro de handlers de server functions / server routes.
//
// POR QUE ISTO AQUI NÃO É SÓ UM `eq("conversation_id", ...)` (11/09/2026):
//
// O hóspede autoriza a notificação no guia — muitas vezes ANTES de abrir o
// chat, quando ainda não existe conversa nenhuma. A rota de inscrição grava
// então `conversation_id = null` e guarda o que de fato identifica aquele
// celular: `property_id` + `guest_session_id`. A busca por conversa, porém,
// só olhava `conversation_id`. Resultado medido no banco: as 4 inscrições
// ativas do sistema estavam TODAS com `conversation_id` null — ou seja,
// nenhum push jamais saiu, nem do atendimento, nem da voz ativa.
//
// A correção é procurar pelos dois caminhos (a conversa, ou a sessão daquele
// hóspede naquele imóvel) e, de quebra, amarrar a inscrição à conversa assim
// que ela passa a existir — o backfill abaixo. A partir daí a rota rápida
// volta a funcionar sozinha.

import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  conversation_id: string | null;
};

export async function sendPushToGuest(
  conversationId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; stale: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: direct } = await supabaseAdmin
    .from("guest_push_subscriptions")
    .select("id, endpoint, p256dh, auth, conversation_id")
    .eq("conversation_id", conversationId)
    .eq("enabled", true);

  const encontradas = new Map<string, SubRow>();
  for (const s of (direct ?? []) as SubRow[]) encontradas.set(s.id, s);

  // Inscrições órfãs da MESMA sessão de hóspede no MESMO imóvel: é o mesmo
  // celular, só que autorizado antes de a conversa existir.
  const { data: conv } = await supabaseAdmin
    .from("property_chat_conversations")
    .select("property_id, guest_session_id")
    .eq("id", conversationId)
    .maybeSingle();
  const c = conv as { property_id: string; guest_session_id: string } | null;
  if (c?.guest_session_id) {
    const { data: bySession } = await supabaseAdmin
      .from("guest_push_subscriptions")
      .select("id, endpoint, p256dh, auth, conversation_id")
      .eq("property_id", c.property_id)
      .eq("guest_session_id", c.guest_session_id)
      .eq("enabled", true);
    for (const s of (bySession ?? []) as SubRow[]) encontradas.set(s.id, s);
  }

  const subs = [...encontradas.values()];
  if (subs.length === 0) return { sent: 0, failed: 0, stale: 0 };

  // Amarra de uma vez as que ainda não apontavam para esta conversa.
  const soltas = subs.filter((s) => s.conversation_id !== conversationId).map((s) => s.id);
  if (soltas.length > 0) {
    await supabaseAdmin
      .from("guest_push_subscriptions")
      .update({ conversation_id: conversationId })
      .in("id", soltas);
  }

  const result = await sendPushToSubscriptions(
    subs.map((s) => ({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })),
    payload,
  );

  if (result.stale.length > 0) {
    await supabaseAdmin.from("guest_push_subscriptions").delete().in("id", result.stale);
  }

  // Marca last_used_at nos que enviaram com sucesso
  if (result.sent > 0) {
    const okIds = subs.filter((s) => !result.stale.includes(s.id)).map((s) => s.id);
    if (okIds.length > 0) {
      await supabaseAdmin
        .from("guest_push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", okIds);
    }
  }

  return { sent: result.sent, failed: result.failed, stale: result.stale.length };
}
