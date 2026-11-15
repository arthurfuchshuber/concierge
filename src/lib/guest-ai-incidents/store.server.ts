/**
 * CHAMADO DE OCORRÊNCIA — acesso ao banco (15/11/2026). Tudo pelo cliente `GuestAiDb` (service_role no servidor).
 * Leituras falham em silêncio (lista vazia): a ausência da tabela nunca derruba a IA.
 */
import type { GuestAiDb } from "@/lib/guest-ai/data/client.server";
import {
  INCIDENT_RECENT_RESOLVED_HOURS,
  type CentralMessage,
  type IncidentSeverity,
  type IncidentView,
} from "./contracts";

export interface ConversationScope {
  id: string;
  propertyId: string;
  reservationId: string | null;
  guestName: string | null;
}

const COLS = "id, summary, severity, category, status";
const view = (r: Record<string, unknown>): IncidentView => ({
  id: String(r["id"]),
  summary: String(r["summary"] ?? ""),
  severity: r["severity"] === "grave" ? "grave" : "normal",
  category: typeof r["category"] === "string" ? (r["category"] as string) : null,
  status: r["status"] === "resolved" ? "resolved" : "open",
});

export async function loadScope(db: GuestAiDb, conversationId: string): Promise<(ConversationScope & { tenantId: string | null }) | null> {
  try {
    const { data } = await db
      .from("property_chat_conversations")
      .select("id, property_id, reservation_id, guest_name, properties:property_id(owner_id)")
      .eq("id", conversationId)
      .maybeSingle();
    if (!data) return null;
    const p = data.properties;
    const owner = (Array.isArray(p) ? p[0] : p)?.owner_id ?? null;
    return { id: data.id, propertyId: data.property_id, reservationId: data.reservation_id ?? null, guestName: data.guest_name ?? null, tenantId: owner };
  } catch {
    return null;
  }
}

/** Conversas da MESMA reserva e do MESMO imóvel (WhatsApp, plataforma, guia): o chat central do hóspede. */
export async function siblingConversationIds(db: GuestAiDb, scope: ConversationScope): Promise<string[]> {
  const ids = new Set<string>([scope.id]);
  if (!scope.reservationId) return [...ids];
  try {
    const { data } = await db
      .from("property_chat_conversations")
      .select("id")
      .eq("reservation_id", scope.reservationId)
      .eq("property_id", scope.propertyId)
      .limit(12);
    for (const r of Array.isArray(data) ? data : []) if (r?.id) ids.add(String(r.id));
  } catch {
    /* só a própria conversa */
  }
  return [...ids];
}

export async function loadOpenIncidents(db: GuestAiDb, scope: ConversationScope): Promise<IncidentView[]> {
  try {
    const q = db.from("guest_ai_incidents").select(COLS).eq("status", "open").eq("property_id", scope.propertyId);
    const { data, error } = await (scope.reservationId
      ? q.or(`conversation_id.eq.${scope.id},reservation_id.eq.${scope.reservationId}`)
      : q.eq("conversation_id", scope.id)
    ).order("opened_at", { ascending: true }).limit(20);
    return error || !Array.isArray(data) ? [] : data.map(view);
  } catch {
    return [];
  }
}

export async function loadRecentlyResolved(db: GuestAiDb, scope: ConversationScope, nowMs: number): Promise<IncidentView[]> {
  try {
    const since = new Date(nowMs - INCIDENT_RECENT_RESOLVED_HOURS * 3_600_000).toISOString();
    const q = db.from("guest_ai_incidents").select(COLS).eq("status", "resolved").eq("property_id", scope.propertyId).gte("resolved_at", since);
    const { data, error } = await (scope.reservationId
      ? q.or(`conversation_id.eq.${scope.id},reservation_id.eq.${scope.reservationId}`)
      : q.eq("conversation_id", scope.id)
    ).limit(10);
    return error || !Array.isArray(data) ? [] : data.map(view);
  } catch {
    return [];
  }
}

/** Últimas mensagens do chat central (sem notas internas), da mais antiga para a mais nova. */
export async function loadCentralMessages(db: GuestAiDb, conversationIds: readonly string[], limit = 30): Promise<CentralMessage[]> {
  try {
    const { data, error } = await db
      .from("property_chat_messages")
      .select("role, sender_type, channel, content, created_at, attachment_transcript")
      .in("conversation_id", [...conversationIds])
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) return [];
    const out: CentralMessage[] = [];
    for (const r of [...data].reverse()) {
      const speaker = r.role === "user" && r.sender_type === "guest" ? "guest" : r.role === "assistant" && r.sender_type === "human" ? "team" : r.role === "assistant" && r.sender_type === "ai" ? "ai" : null;
      const text = String(r.content ?? "").trim() || String(r.attachment_transcript ?? "").trim();
      if (!speaker || !text || !r.created_at) continue;
      out.push({ speaker, channel: String(r.channel ?? "guide_chat"), at: String(r.created_at), text });
    }
    return out;
  } catch {
    return [];
  }
}

export async function insertIncident(
  db: GuestAiDb,
  i: { tenantId: string; scope: ConversationScope; summary: string; severity: IncidentSeverity; category: string | null; messageId: string | null },
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("guest_ai_incidents")
      .insert({
        tenant_id: i.tenantId, property_id: i.scope.propertyId, conversation_id: i.scope.id, reservation_id: i.scope.reservationId,
        summary: i.summary, severity: i.severity, category: i.category, opened_message_id: i.messageId,
      })
      .select("id")
      .maybeSingle();
    return error || !data ? null : String(data.id);
  } catch {
    return null;
  }
}

export async function markResolved(db: GuestAiDb, id: string, by: "ai" | "human", reason: string, nowIso: string): Promise<boolean> {
  try {
    const { data, error } = await db
      .from("guest_ai_incidents")
      .update({ status: "resolved", resolved_at: nowIso, resolved_by: by, resolution_reason: reason.slice(0, 300) || null, updated_at: nowIso })
      .eq("id", id)
      .eq("status", "open")
      .select("id");
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

export async function markReopened(db: GuestAiDb, id: string, nowIso: string): Promise<boolean> {
  try {
    const { data: cur } = await db.from("guest_ai_incidents").select("reopened_count").eq("id", id).eq("status", "resolved").maybeSingle();
    if (!cur) return false;
    const { data, error } = await db
      .from("guest_ai_incidents")
      .update({ status: "open", resolved_at: null, resolved_by: null, resolution_reason: null, reopened_count: Number(cur.reopened_count ?? 0) + 1, updated_at: nowIso })
      .eq("id", id)
      .eq("status", "resolved")
      .select("id");
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** Decisões humanas PENDENTES da conversa, como assunto aberto (a IA segue com os demais assuntos; 15/11/2026). */
const DECISION_TOPIC: Record<string, string> = {
  late_checkout: "pedido de saída tardia aguardando decisão da equipe",
  early_checkin: "pedido de entrada antecipada aguardando decisão da equipe",
  operational_concession: "pedido de exceção aguardando decisão da equipe",
  general_decision: "pedido aguardando decisão da equipe",
};
export async function loadPendingDecisionCases(db: GuestAiDb, conversationId: string): Promise<Array<{ id: string; topic: string }>> {
  try {
    const { data, error } = await db
      .from("guest_ai_human_decisions")
      .select("id, kind")
      .eq("conversation_id", conversationId)
      .eq("status", "pending")
      .limit(10);
    if (error || !Array.isArray(data)) return [];
    return data.map((r: Record<string, unknown>) => ({ id: String(r["id"]), topic: DECISION_TOPIC[String(r["kind"])] ?? DECISION_TOPIC["general_decision"]! }));
  } catch {
    return [];
  }
}
