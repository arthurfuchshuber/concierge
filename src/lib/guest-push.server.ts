// Helper server-only: envia push para o hóspede de uma conversa.
// Importar somente dentro de handlers de server functions / server routes.

import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";

export async function sendPushToGuest(
  conversationId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; stale: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: subs, error } = await supabaseAdmin
    .from("guest_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("conversation_id", conversationId)
    .eq("enabled", true);

  if (error || !subs || subs.length === 0) {
    return { sent: 0, failed: 0, stale: 0 };
  }

  const result = await sendPushToSubscriptions(
    subs.map((s) => ({
      id: s.id as string,
      endpoint: s.endpoint as string,
      p256dh: s.p256dh as string,
      auth: s.auth as string,
    })),
    payload,
  );

  if (result.stale.length > 0) {
    await supabaseAdmin
      .from("guest_push_subscriptions")
      .delete()
      .in("id", result.stale);
  }

  // Marca last_used_at nos que enviaram com sucesso
  if (result.sent > 0) {
    const okIds = subs
      .filter((s) => !result.stale.includes(s.id as string))
      .map((s) => s.id as string);
    if (okIds.length > 0) {
      await supabaseAdmin
        .from("guest_push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", okIds);
    }
  }

  return { sent: result.sent, failed: result.failed, stale: result.stale.length };
}
