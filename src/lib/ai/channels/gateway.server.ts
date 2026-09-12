/**
 * Channel Gateway — abstração de origem da mensagem.
 *
 * Registra o canal de cada conversa (`ai_conversation_channels`) e entrega ao
 * núcleo apenas o formato normalizado. Novos canais (WhatsApp, Airbnb Inbox,
 * Booking, e-mail, app próprio) entram registrando um adaptador aqui — nenhuma
 * linha do Agent Core precisa mudar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "../tenant/context.server";
import type { ChannelAdapter, ChannelType, InboundMessage, OutboundMessage } from "./types";

const adapters = new Map<ChannelType, ChannelAdapter>();

export function registerChannelAdapter<T>(adapter: ChannelAdapter<T>): void {
  adapters.set(adapter.type, adapter as ChannelAdapter);
}

export function getChannelAdapter(type: ChannelType): ChannelAdapter | null {
  return adapters.get(type) ?? null;
}

/** Adaptador nativo do guia (formato já normalizado). */
registerChannelAdapter<Partial<InboundMessage>>({
  type: "guide_chat",
  parse: (raw) => normalizeInbound("guide_chat", raw),
});

/** Normaliza qualquer carga parcial em `InboundMessage`. */
export function normalizeInbound(
  channel: ChannelType,
  raw: Partial<InboundMessage> | null | undefined,
): InboundMessage | null {
  if (!raw?.propertyId || !raw.text) return null;
  return {
    channel,
    externalReference: raw.externalReference ?? null,
    externalThreadId: raw.externalThreadId ?? null,
    propertyId: String(raw.propertyId),
    conversationId: raw.conversationId ?? null,
    sessionId: raw.sessionId ?? `ch:${channel}:${raw.externalReference ?? "anon"}`,
    guestName: raw.guestName ?? null,
    text: String(raw.text),
    locale: raw.locale ?? null,
    attachments: raw.attachments ?? [],
    receivedAt: raw.receivedAt ?? new Date().toISOString(),
    metadata: raw.metadata ?? {},
  };
}

/** Vincula (idempotente) a conversa ao canal de origem. */
export async function bindConversationChannel(params: {
  supabase: SupabaseClient;
  tenant: TenantContext;
  conversationId: string;
  channel: ChannelType;
  externalReference?: string | null;
  externalThreadId?: string | null;
  locale?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await params.supabase
      .from("ai_conversation_channels")
      .upsert(
        {
          conversation_id: params.conversationId,
          tenant_id: params.tenant.tenantId,
          property_id: params.tenant.propertyId,
          channel_type: params.channel,
          external_reference: params.externalReference ?? null,
          external_thread_id: params.externalThreadId ?? null,
          locale: params.locale ?? null,
          metadata: (params.metadata ?? {}) as never,
        },
        { onConflict: "conversation_id" },
      );
  } catch (err) {
    console.error("[channel] falha ao vincular canal", err);
  }
}

export async function getConversationChannel(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ channel: ChannelType; externalReference: string | null } | null> {
  const { data } = await supabase
    .from("ai_conversation_channels")
    .select("channel_type, external_reference")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (!data) return null;
  return {
    channel: (data.channel_type as ChannelType) ?? "guide_chat",
    externalReference: data.external_reference ?? null,
  };
}

/** Entrega a resposta ao canal de origem, quando o adaptador suportar. */
export async function deliverOutbound(message: OutboundMessage): Promise<boolean> {
  const adapter = adapters.get(message.channel);
  if (!adapter?.deliver) return false;
  try {
    await adapter.deliver(message);
    return true;
  } catch (err) {
    console.error("[channel] entrega falhou", message.channel, err);
    return false;
  }
}
