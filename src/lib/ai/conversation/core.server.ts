/**
 * Omnichannel Conversation Core.
 *
 * Uma única Conversation Entity por hóspede/imóvel, independentemente do canal.
 * WhatsApp e chat da plataforma escrevem no MESMO registro (`ai_conversations`)
 * e no MESMO histórico (`ai_messages`). O canal só define para onde a resposta
 * volta — nunca cria uma conversa paralela.
 *
 * Este módulo é aditivo: as tabelas legadas (`property_chat_*`) continuam
 * funcionando e são espelhadas aqui via `legacy_conversation_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type CoreChannel = "platform_chat" | "whatsapp";
export type CoreSender = "guest" | "agent" | "human_operator" | "system";

export type CoreConversation = {
  id: string;
  tenantId: string;
  propertyId: string | null;
  guestId: string | null;
  channelOrigin: CoreChannel;
  status: string;
  assignedAgent: string | null;
};

export type CoreMessage = {
  id: string;
  senderType: CoreSender;
  channelOrigin: CoreChannel;
  content: string;
  agentKey: string | null;
  createdAt: string;
};

/** Normaliza a identidade do hóspede (telefone tem prioridade sobre sessão). */
export function guestIdentity(params: { phone?: string | null; sessionId?: string | null; name?: string | null }): string {
  const digits = (params.phone ?? "").replace(/[^\d]/g, "");
  if (digits.length >= 8) return `phone:${digits.slice(-11)}`;
  if (params.sessionId) return `session:${params.sessionId}`;
  return `name:${(params.name ?? "anon").trim().toLowerCase()}`;
}

/**
 * Resolve (ou cria) a conversa unificada.
 * Ordem de busca: conversa legada vinculada → identidade do hóspede no imóvel.
 */
export async function resolveCoreConversation(params: {
  supabase: SupabaseClient;
  tenantId: string;
  propertyId: string | null;
  legacyConversationId?: string | null;
  reservationId?: string | null;
  channel: CoreChannel;
  guestId?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
}): Promise<CoreConversation | null> {
  const {
    supabase, tenantId, propertyId, legacyConversationId, channel,
  } = params;
  const guestId = params.guestId ?? guestIdentity({ phone: params.guestPhone, name: params.guestName });

  try {
    if (legacyConversationId) {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id, tenant_id, property_id, guest_id, channel_origin, status, assigned_agent")
        .eq("legacy_conversation_id", legacyConversationId)
        .maybeSingle();
      if (data) return mapConversation(data);
    }

    if (propertyId && guestId) {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id, tenant_id, property_id, guest_id, channel_origin, status, assigned_agent")
        .eq("tenant_id", tenantId)
        .eq("property_id", propertyId)
        .eq("guest_id", guestId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        // Um hóspede que migrou de canal continua na MESMA conversa.
        if (legacyConversationId) {
          await supabase
            .from("ai_conversations")
            .update({ legacy_conversation_id: legacyConversationId })
            .eq("id", data.id)
            .is("legacy_conversation_id", null);
        }
        return mapConversation(data);
      }
    }

    const { data: created } = await supabase
      .from("ai_conversations")
      .insert({
        tenant_id: tenantId,
        property_id: propertyId,
        guest_id: guestId,
        guest_name: params.guestName ?? null,
        guest_phone: params.guestPhone ?? null,
        reservation_id: params.reservationId ?? null,
        legacy_conversation_id: legacyConversationId ?? null,
        channel_origin: channel,
        status: "open",
      })
      .select("id, tenant_id, property_id, guest_id, channel_origin, status, assigned_agent")
      .single();
    if (created) {
      const { logSystemEvent } = await import("../audit/events.server");
      void logSystemEvent(supabase, {
        tenantId,
        actorType: "GUEST",
        actorId: guestId ?? null,
        actorName: params.guestName ?? null,
        eventType: "conversation_created",
        eventCategory: "CONVERSATION",
        entityType: "ai_conversations",
        entityId: String(created.id),
        conversationId: String(created.id),
        propertyId,
        channel,
        description: "Nova conversa iniciada",
        reason: "Primeiro contato do hóspede neste canal",
        source: "conversation_core",
      });
    }
    return created ? mapConversation(created) : null;
  } catch (err) {
    console.error("[conversation-core] resolve falhou", err);
    return null;
  }
}

/** Grava uma mensagem no histórico unificado (nunca lança). */
export async function appendCoreMessage(params: {
  supabase: SupabaseClient;
  conversationId: string;
  tenantId: string;
  propertyId?: string | null;
  senderType: CoreSender;
  channel: CoreChannel;
  content: string;
  agentKey?: string | null;
  externalId?: string | null;
  deliveryStatus?: string | null;
  confidence?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await params.supabase.from("ai_messages").insert({
      conversation_id: params.conversationId,
      tenant_id: params.tenantId,
      property_id: params.propertyId ?? null,
      sender_type: params.senderType,
      channel_origin: params.channel,
      message_content: params.content,
      agent_key: params.agentKey ?? null,
      external_id: params.externalId ?? null,
      delivery_status: params.deliveryStatus ?? null,
      confidence: params.confidence ?? null,
      tokens_in: params.tokensIn ?? null,
      tokens_out: params.tokensOut ?? null,
      cost_usd: params.costUsd ?? null,
      metadata: (params.metadata ?? {}) as never,
    });
    await params.supabase
      .from("ai_conversations")
      .update({ last_message_at: new Date().toISOString(), channel_origin: params.channel })
      .eq("id", params.conversationId);

    const { logSystemEvent } = await import("../audit/events.server");
    void logSystemEvent(params.supabase, {
      tenantId: params.tenantId,
      actorType: params.senderType === "guest" ? "GUEST" : params.senderType === "agent" ? "AI_AGENT" : params.senderType === "system" ? "SYSTEM" : "USER",
      actorId: params.agentKey ?? params.senderType,
      eventType: params.senderType === "guest" ? "message_received" : "message_sent",
      eventCategory: "CONVERSATION",
      entityType: "ai_messages",
      entityId: params.conversationId,
      conversationId: params.conversationId,
      propertyId: params.propertyId ?? null,
      channel: params.channel,
      description: params.content.slice(0, 180),
      reason: null,
      source: "conversation_core",
    });
  } catch (err) {
    console.error("[conversation-core] append falhou", err);
  }
}

/** Histórico unificado — todos os canais na ordem cronológica. */
export async function getUnifiedHistory(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 40,
): Promise<CoreMessage[]> {
  const { data } = await supabase
    .from("ai_messages")
    .select("id, sender_type, channel_origin, message_content, agent_key, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .map((m) => ({
      id: String(m.id),
      senderType: m.sender_type as CoreSender,
      channelOrigin: (m.channel_origin as CoreChannel) ?? "platform_chat",
      content: String(m.message_content ?? ""),
      agentKey: (m.agent_key as string | null) ?? null,
      createdAt: String(m.created_at),
    }))
    .reverse();
}

/** Atualiza status/agente responsável (auditoria de decisão). */
export async function setConversationState(params: {
  supabase: SupabaseClient;
  conversationId: string;
  status?: string;
  assignedAgent?: string | null;
  assignedUserId?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (params.status) patch.status = params.status;
  if (params.assignedAgent !== undefined) patch.assigned_agent = params.assignedAgent;
  if (params.assignedUserId !== undefined) patch.assigned_user_id = params.assignedUserId;
  if (Object.keys(patch).length === 0) return;
  try {
    await params.supabase.from("ai_conversations").update(patch).eq("id", params.conversationId);
  } catch (err) {
    console.error("[conversation-core] state falhou", err);
  }
}

function mapConversation(row: Record<string, unknown>): CoreConversation {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    propertyId: (row.property_id as string | null) ?? null,
    guestId: (row.guest_id as string | null) ?? null,
    channelOrigin: ((row.channel_origin as CoreChannel) ?? "platform_chat"),
    status: String(row.status ?? "open"),
    assignedAgent: (row.assigned_agent as string | null) ?? null,
  };
}
