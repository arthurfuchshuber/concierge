import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Public shape (safe to expose to client): no token.
export type WhatsappConfigPublic = {
  provider: string;
  senderNumber: string | null;
  projectId: string | null;
  appId: string | null;
  status: "pending" | "testing" | "active" | "error";
  lastVerifiedAt: string | null;
  lastError: string | null;
  webhookUrl: string;
  webhookSecretMasked: string;
  hasToken: boolean;
};

const CONFIG_INPUT = z.object({
  senderNumber: z.string().trim().min(6).max(20),
  projectId: z.string().trim().min(3),
  appId: z.string().trim().min(3),
  apiToken: z.string().trim().min(8).optional(),
});

function maskSecret(s: string | null): string {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(s.length - 8)}${s.slice(-4)}`;
}

function siteOrigin(): string {
  // Prefer VITE_APP_URL / SITE_URL if set; fallback to lovable.app project URL.
  return (
    process.env.SITE_URL ||
    process.env.VITE_APP_URL ||
    "https://sigmaconcierge.lovable.app"
  );
}

export const getMyWhatsappConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsappConfigPublic> => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("host_whatsapp_config")
      .select("provider, sender_number, service_plan_id, app_id, api_token_encrypted, webhook_secret, status, last_verified_at, last_error")
      .eq("owner_id", userId)
      .maybeSingle();
    const webhookUrl = `${siteOrigin()}/api/public/whatsapp/sinch-webhook?owner=${userId}`;
    return {
      provider: (data?.provider as string) ?? "sinch",
      senderNumber: (data?.sender_number as string) ?? null,
      projectId: (data?.service_plan_id as string) ?? null,
      appId: (data?.app_id as string) ?? null,
      status: ((data?.status as WhatsappConfigPublic["status"]) ?? "pending"),
      lastVerifiedAt: (data?.last_verified_at as string) ?? null,
      lastError: (data?.last_error as string) ?? null,
      webhookUrl,
      webhookSecretMasked: maskSecret((data?.webhook_secret as string) ?? null),
      hasToken: Boolean(data?.api_token_encrypted),
    };
  });

export const saveMyWhatsappConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CONFIG_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let encrypted: string | undefined;
    if (data.apiToken) {
      const { encryptToken } = await import("@/lib/whatsapp.server");
      encrypted = encryptToken(data.apiToken);
    }
    const { error } = await supabase
      .from("host_whatsapp_config")
      .upsert({
        owner_id: userId,
        provider: "sinch",
        sender_number: data.senderNumber.replace(/[^\d+]/g, ""),
        service_plan_id: data.projectId,
        app_id: data.appId,
        status: "testing",
        last_error: null,
        updated_at: new Date().toISOString(),
        ...(encrypted ? { api_token_encrypted: encrypted } : {}),
      }, { onConflict: "owner_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectMyWhatsappConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("host_whatsapp_config")
      .delete()
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Send a proactive/reply WhatsApp message from a conversation ----
const SEND_INPUT = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});

export const sendWhatsappFromConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => SEND_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load conversation + property + owner
    const { data: conv, error: convErr } = await supabase
      .from("property_chat_conversations")
      .select("id, property_id, guest_session_id, guest_name, properties:property_id(id, owner_id, slug)")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (convErr || !conv) throw new Error("Conversa não encontrada");
    const ownerId = (conv.properties as { owner_id?: string } | null)?.owner_id;
    const propertySlug = (conv.properties as { slug?: string } | null)?.slug ?? null;
    if (!ownerId) throw new Error("Propriedade sem dono");

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
    const { data: cfg } = await supabase
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

    // Expande [[tag:...]] para URLs de deep-link no guia deste imóvel.
    const { expandTagsForWhatsapp } = await import("@/lib/guide-tags");
    const origin = siteOrigin();
    const finalText = propertySlug
      ? expandTagsForWhatsapp(data.text, { origin, slug: propertySlug })
      : data.text;


    let sinchMsgId = "";
    try {
      const res = await sinchSendText(
        { projectId: cfg.service_plan_id as string, appId: cfg.app_id as string, token, senderNumber: cfg.sender_number as string },
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
      .update({ ai_paused: true, status: "assigned", assigned_to: userId, last_message_at: new Date().toISOString() })
      .eq("id", data.conversationId);

    if (cfg.status !== "active") {
      await supabase.from("host_whatsapp_config").update({ status: "active", last_verified_at: new Date().toISOString(), last_error: null }).eq("owner_id", ownerId);
    }

    return { ok: true };
  });
