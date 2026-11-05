/**
 * NÚCLEO ÚNICO de envio humano pelo WhatsApp oficial (Sinch) — o corpo de `sendWhatsappFromConversation`, só
 * servidor. Fora de `whatsapp.functions.ts` porque aquele arquivo também vai ao cliente: uma função exportada lá
 * levaria `whatsapp.server` (node:crypto) ao bundle do navegador. Carregado por import dinâmico.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { SITE_ORIGIN } from "@/lib/site-url";
import { pausePatch } from "@/lib/chat/pause";

export interface WhatsappSendResult {
  ok: true;
  /** Sempre nulo: a gravação não lê a linha de volta (comportamento original). O Copiloto reconcilia. */
  messageId: string | null;
  /** Id da mensagem no Sinch. */
  externalId: string | null;
}

/**
 * ROTINA ÚNICA de envio humano pelo WhatsApp oficial (Sinch). É o corpo de `sendWhatsappFromConversation`,
 * extraído para que o Copiloto (`copilot.functions.ts`) envie a sugestão APROVADA pela mesma rotina —
 * permissão, telefone DESTA conversa, configuração da conta, expansão de tags, gravação e pausa da IA — sem
 * nenhum mecanismo paralelo. Autoria: `userId` vem SEMPRE da sessão autenticada do chamador.
 */
export async function sendWhatsappMessageToConversation(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: { conversationId: string; text: string },
): Promise<WhatsappSendResult> {
  // Load conversation + property + owner
  const { data: conv, error: convErr } = await supabase
    .from("property_chat_conversations")
    .select(
      "id, property_id, guest_session_id, guest_name, properties:property_id(id, owner_id, slug, checkin_time, checkin_time_max, checkout_time, checkout_time_min, wifi_ssid, wifi_password, gate_code, lock_code, pin_code, address, host_name, host_phone, house_rules, checkin_instructions, checkout_instructions, gate_instructions, lock_instructions, marketplace_links)",
    )
    .eq("id", data.conversationId)
    .maybeSingle();
  if (convErr || !conv) throw new Error("Conversa não encontrada");
  const propRow = (conv.properties as Record<string, unknown> | null) ?? null;
  const ownerId = (propRow?.owner_id as string | undefined) ?? undefined;
  const propertySlug = (propRow?.slug as string | undefined) ?? null;
  if (!ownerId) throw new Error("Propriedade sem dono");
  // Só o titular ou membro com permissão explícita de responder envia em nome da conta.
  const { requireMemberPermission } = await import("@/lib/member-permissions.server");
  await requireMemberPermission(supabase, userId, ownerId, "chat_respond");

  // Resolve the guest phone for THIS conversation specifically.
  // Never fall back to "most recent log for the property" — that could address
  // a different (past/future) guest instead of the one the operator is chatting with.
  let phone: string | null = null;
  let phoneCountry: string | null = null;

  const sessionId = (conv.guest_session_id as string | null) ?? null;
  // 1. Sinch inbound webhook encodes phone in session id as "wa:<digits>".
  if (sessionId && sessionId.startsWith("wa:")) {
    const digits = sessionId.slice(3).replace(/[^\d]/g, "");
    if (digits) phone = digits;
  }

  // 2. Match guide_section_events by the conversation's session id.
  if (!phone && sessionId) {
    const { data: ev } = await supabase
      .from("guide_section_events")
      .select("guest_phone")
      .eq("guest_session_id", sessionId)
      .not("guest_phone", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ev?.guest_phone) phone = String(ev.guest_phone);
  }

  // 3. Fallback: guide_access_logs filtered by property AND the conversation's guest name.
  if (!phone) {
    const guestName = (conv.guest_name as string | null)?.trim();
    if (guestName) {
      const { data: log } = await supabase
        .from("guide_access_logs")
        .select("guest_phone, guest_phone_country, guest_name")
        .eq("property_id", conv.property_id)
        .ilike("guest_name", guestName)
        .not("guest_phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (log?.guest_phone) {
        phone = String(log.guest_phone);
        phoneCountry = (log.guest_phone_country as string | null) ?? null;
      }
    }
  }

  if (!phone) throw new Error("Este hóspede ainda não informou telefone");

  // Load host config
  const { data: cfg } = await (
    await import("@/integrations/supabase/client.server")
  ).supabaseAdmin
    .from("host_whatsapp_config")
    .select("provider, sender_number, service_plan_id, app_id, api_token_encrypted, status")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (!cfg?.api_token_encrypted || !cfg.service_plan_id || !cfg.app_id || !cfg.sender_number) {
    throw new Error("WhatsApp Business não está configurado nesta conta");
  }

  const { decryptToken, sinchSendText, normalizePhone } = await import("@/lib/whatsapp.server");
  const token = decryptToken(cfg.api_token_encrypted as string);
  const to = normalizePhone((phoneCountry ?? "") + phone);

  // Expande [[info:...]] com valores da propriedade e [[tag:...]] para deep-links do guia.
  const { expandTagsForWhatsapp, expandInfoTags } = await import("@/lib/guide-tags");
  const origin = SITE_ORIGIN;
  const withInfo = expandInfoTags(data.text, propRow as never);
  const finalText = propertySlug
    ? expandTagsForWhatsapp(withInfo, { origin, slug: propertySlug })
    : withInfo;

  let sinchMsgId = "";
  try {
    const res = await sinchSendText(
      {
        projectId: cfg.service_plan_id as string,
        appId: cfg.app_id as string,
        token,
        senderNumber: cfg.sender_number as string,
      },
      { toE164: to, text: finalText },
    );
    sinchMsgId = res.messageId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Persist as failed message so the operator sees the failure in the timeline
    await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: finalText,
      sender_type: "human",
      sender_user_id: userId,
      channel: "whatsapp",
      delivery_status: "failed",
      sent_via_number: cfg.sender_number as string,
    });
    await supabase
      .from("host_whatsapp_config")
      .update({ status: "error", last_error: msg })
      .eq("owner_id", ownerId);
    throw new Error(`Falha ao enviar WhatsApp: ${msg}`);
  }

  // Insert as outbound message; pause AI as we do for regular human replies
  const { error } = await supabase.from("property_chat_messages").insert({
    conversation_id: data.conversationId,
    role: "assistant",
    content: finalText,
    sender_type: "human",
    sender_user_id: userId,
    channel: "whatsapp",
    delivery_status: "sent",
    external_id: sinchMsgId || null,
    sent_via_number: cfg.sender_number as string,
  });
  if (error) throw new Error(error.message);
  await supabase
    .from("property_chat_conversations")
    .update({
      ...pausePatch(),
      status: "assigned",
      assigned_to: userId,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", data.conversationId);

  if (cfg.status !== "active") {
    await supabase
      .from("host_whatsapp_config")
      .update({ status: "active", last_verified_at: new Date().toISOString(), last_error: null })
      .eq("owner_id", ownerId);
  }

  // A gravação acima é a MESMA de antes (sem `select` de retorno, para não exigir nada além do que já exigia).
  // Quem precisa do id da linha (o Copiloto) o reconcilia pelo autor e pelo instante.
  return { ok: true, messageId: null, externalId: sinchMsgId || null };
}
