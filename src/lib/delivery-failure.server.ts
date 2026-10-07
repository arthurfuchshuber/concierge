/**
 * Falha/bloqueio de entrega por parte de uma plataforma (Airbnb, WhatsApp...).
 *
 * Regra: nenhuma resposta bloqueada fica silenciosa. A conversa vira
 * "precisa de humano" e são notificados os responsáveis do imóvel E os
 * administradores do SaaS (papel `admin`), para informar o cliente ou assumir.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient<any>;

export async function reportDeliveryFailure(
  admin: Admin,
  opts: {
    conversationId: string;
    propertyId: string;
    channel: string;
    propertyName?: string | null;
    guestName?: string | null;
    guestMessage?: string | null;
    detail: string;
  },
): Promise<void> {
  const platform = opts.channel === "airbnb" ? "Airbnb" : opts.channel === "whatsapp" ? "WhatsApp" : opts.channel;
  const reason = `Envio bloqueado/falhou no ${platform} (${opts.detail}). A resposta da IA não chegou ao hóspede — assuma a conversa.`;

  try {
    await admin
      .from("property_chat_conversations")
      .update({
        status: "needs_human",
        ai_paused: false,
        handoff_reason: reason,
        handoff_urgency: "high",
        handoff_at: new Date().toISOString(),
      })
      .eq("id", opts.conversationId);
  } catch (e) {
    console.error("[delivery-failure] handoff falhou", e);
  }

  try {
    const { data: prop } = await admin.from("properties").select("owner_id").eq("id", opts.propertyId).maybeSingle();
    if (prop?.owner_id) {
      await admin.from("ai_alerts").insert({
        tenant_id: prop.owner_id,
        property_id: opts.propertyId,
        kind: "delivery_failure",
        severity: "critical",
        title: `Mensagem bloqueada pelo ${platform}`,
        detail: reason,
      });
    }
  } catch (e) {
    console.error("[delivery-failure] alerta falhou", e);
  }

  try {
    const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
    const ids = new Set(await getPropertyNotifiableUsers(admin as never, opts.propertyId));
    const { data: admins } = await admin.from("user_roles").select("user_id").eq("role", "admin");
    for (const a of admins ?? []) ids.add(a.user_id as string);
    await sendHandoffPush(admin as never, {
      userIds: Array.from(ids),
      conversationId: opts.conversationId,
      propertyName: opts.propertyName ?? null,
      guestName: opts.guestName ?? null,
      guestMessage: opts.guestMessage ?? null,
      checkinDate: null,
      reason,
      urgency: "high",
    });
  } catch (e) {
    console.error("[delivery-failure] push falhou", e);
  }
}
