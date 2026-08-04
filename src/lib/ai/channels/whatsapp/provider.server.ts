/**
 * WhatsApp Provider Layer (canal → Conversation Core).
 *
 * Responsável por: validar webhook, normalizar payload, identificar hóspede,
 * vincular a conversa existente e entregar respostas de volta ao WhatsApp.
 * Nenhuma credencial é armazenada aqui: apenas uma *referência* criptografada
 * no registry (`ai_channel_connections`), com o segredo real em
 * `host_whatsapp_config` (token cifrado com AES-256-GCM).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerChannelAdapter, normalizeInbound } from "../gateway.server";
import type { InboundMessage, OutboundMessage } from "../types";

export type WhatsappInboundRaw = {
  ownerId: string;
  propertyId: string;
  event: Record<string, unknown>;
};

/** Extrai texto + identidade do payload do provedor (Sinch Conversations). */
export function parseSinchEvent(event: Record<string, unknown>): {
  text: string | null;
  fromIdentity: string | null;
  messageId: string | null;
  deliveryStatus: string | null;
} {
  const e = event as Record<string, any>;
  const text =
    e?.message?.contact_message?.text_message?.text ??
    e?.message?.text_message?.text ??
    e?.text_message?.text ??
    null;
  const fromIdentity =
    e?.message?.channel_identity?.identity ??
    e?.channel_identity?.identity ??
    e?.message?.sender?.identity ??
    null;
  const messageId = e?.message?.id ?? e?.message_id ?? e?.message_delivery_report?.message_id ?? null;
  const rawStatus = String(e?.message_delivery_report?.status ?? e?.status ?? "").toLowerCase();
  const deliveryStatus =
    rawStatus.includes("delivered") ? "delivered" :
    rawStatus.includes("read") ? "read" :
    rawStatus.includes("failed") || rawStatus.includes("rejected") ? "failed" :
    rawStatus.includes("dispatched") || rawStatus.includes("sent") ? "sent" : null;
  return { text: text ? String(text) : null, fromIdentity: fromIdentity ? String(fromIdentity) : null, messageId, deliveryStatus };
}

/** Adaptador registrado no Channel Gateway. */
registerChannelAdapter<WhatsappInboundRaw>({
  type: "whatsapp",
  parse: (raw): InboundMessage | null => {
    const { text, fromIdentity } = parseSinchEvent(raw?.event ?? {});
    if (!text || !fromIdentity) return null;
    const digits = fromIdentity.replace(/[^\d]/g, "");
    return normalizeInbound("whatsapp", {
      propertyId: raw.propertyId,
      text,
      externalReference: digits,
      sessionId: `wa:${digits}`,
      metadata: { ownerId: raw.ownerId },
    });
  },
  deliver: async (message: OutboundMessage) => {
    // A entrega efetiva usa a configuração do tenant; feita pelo caller que
    // possui o SupabaseClient privilegiado (ver `sendWhatsappText`).
    console.info("[whatsapp] entrega delegada", message.conversationId);
  },
});

/** Envia texto pelo WhatsApp do tenant. Retorna o id externo da mensagem. */
export async function sendWhatsappText(params: {
  supabase: SupabaseClient;
  tenantId: string;
  toPhone: string;
  text: string;
}): Promise<{ messageId: string }> {
  const { data: cfg } = await params.supabase
    .from("host_whatsapp_config")
    .select("sender_number, service_plan_id, app_id, api_token_encrypted")
    .eq("owner_id", params.tenantId)
    .maybeSingle();
  if (!cfg?.api_token_encrypted || !cfg.service_plan_id || !cfg.app_id || !cfg.sender_number) {
    throw new Error("WhatsApp não conectado para este tenant");
  }
  const { decryptToken, sinchSendText, normalizePhone } = await import("@/lib/whatsapp.server");
  return sinchSendText(
    {
      projectId: cfg.service_plan_id as string,
      appId: cfg.app_id as string,
      token: decryptToken(cfg.api_token_encrypted as string),
      senderNumber: cfg.sender_number as string,
    },
    { toE164: normalizePhone(params.toPhone), text: params.text },
  );
}

// ───────────────────────── Connection Registry ─────────────────────────

/** Registra/atualiza a conexão de canal do tenant (sem credenciais em claro). */
export async function upsertChannelConnection(params: {
  supabase: SupabaseClient;
  tenantId: string;
  channelType: string;
  provider: string;
  credentialsReference: string | null;
  externalIdentity?: string | null;
  status: "pending" | "active" | "error" | "disconnected";
  lastError?: string | null;
}): Promise<void> {
  try {
    await params.supabase
      .from("ai_channel_connections")
      .upsert(
        {
          tenant_id: params.tenantId,
          channel_type: params.channelType,
          provider: params.provider,
          credentials_reference: params.credentialsReference,
          external_identity: params.externalIdentity ?? null,
          status: params.status,
          last_error: params.lastError ?? null,
          connected_at: params.status === "active" ? new Date().toISOString() : null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,channel_type" },
      );
  } catch (err) {
    console.error("[whatsapp] registry falhou", err);
  }
}

export async function markChannelSeen(supabase: SupabaseClient, tenantId: string, channelType = "whatsapp"): Promise<void> {
  try {
    await supabase
      .from("ai_channel_connections")
      .update({ last_seen_at: new Date().toISOString(), status: "active", last_error: null })
      .eq("tenant_id", tenantId)
      .eq("channel_type", channelType);
  } catch { /* silencioso */ }
}
