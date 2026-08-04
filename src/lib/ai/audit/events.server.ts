/**
 * Enterprise Audit Trail — Event Log Engine.
 *
 * Único ponto autorizado a gravar em `ai_system_events`. Registra QUEM fez,
 * QUANDO, EM QUAL CONTA, COM QUAL PERMISSÃO, POR QUE, DE ONDE e O RESULTADO.
 *
 * Política de privacidade do raciocínio: nunca gravamos chain-of-thought.
 * Somente motivo estruturado, classificação e evidências utilizadas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ActorType =
  | "USER"
  | "ADMIN"
  | "OWNER"
  | "GUEST"
  | "AI_AGENT"
  | "SYSTEM"
  | "INTEGRATION"
  | "CRON_JOB";

export const ACTOR_TYPES: ActorType[] = [
  "USER",
  "ADMIN",
  "OWNER",
  "GUEST",
  "AI_AGENT",
  "SYSTEM",
  "INTEGRATION",
  "CRON_JOB",
];

export type EventCategory =
  | "AUTHENTICATION"
  | "PERMISSIONS"
  | "USER_MANAGEMENT"
  | "CONVERSATION"
  | "AI_DECISION"
  | "MEMORY"
  | "LEARNING"
  | "INTEGRATIONS"
  | "SECURITY";

export const EVENT_CATEGORIES: Record<EventCategory, { label: string; events: string[] }> = {
  AUTHENTICATION: {
    label: "Autenticação",
    events: ["login_success", "login_failed", "logout", "password_changed", "oauth_connected"],
  },
  PERMISSIONS: {
    label: "Permissões",
    events: ["permission_created", "permission_changed", "permission_removed", "access_denied"],
  },
  USER_MANAGEMENT: {
    label: "Usuários",
    events: ["user_created", "user_updated", "user_deleted", "role_changed"],
  },
  CONVERSATION: {
    label: "Conversas",
    events: ["conversation_created", "message_received", "message_sent", "conversation_closed"],
  },
  AI_DECISION: {
    label: "Decisão da IA",
    events: [
      "agent_selected",
      "tool_called",
      "memory_retrieved",
      "source_used",
      "confidence_generated",
      "reflection_completed",
    ],
  },
  MEMORY: {
    label: "Memória",
    events: ["memory_created", "memory_updated", "memory_used", "memory_archived"],
  },
  LEARNING: {
    label: "Aprendizado",
    events: ["learning_candidate_created", "learning_approved", "learning_rejected", "knowledge_promoted"],
  },
  INTEGRATIONS: {
    label: "Integrações",
    events: ["integration_connected", "integration_disconnected", "webhook_received", "api_error"],
  },
  SECURITY: {
    label: "Segurança",
    events: ["tenant_access_attempt", "permission_violation", "suspicious_activity"],
  },
};

export type Severity = "info" | "notice" | "warning" | "error" | "critical";

export type SystemEventInput = {
  tenantId?: string | null;
  organizationId?: string | null;
  userId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  permissionSnapshot?: Record<string, unknown> | null;
  eventType: string;
  eventCategory: EventCategory;
  entityType?: string | null;
  entityId?: string | null;
  action?: string | null;
  description?: string | null;
  /** Motivo estruturado — nunca raciocínio bruto do modelo. */
  reason?: string | null;
  source?: string;
  channel?: string | null;
  ipReference?: string | null;
  metadata?: Record<string, unknown> | null;
  severity?: Severity;
  conversationId?: string | null;
  propertyId?: string | null;
  correlationId?: string | null;
  result?: "success" | "failure" | "pending" | null;
};

/** Grava um evento. Auditoria nunca pode derrubar a operação principal. */
export async function logSystemEvent(
  supabase: SupabaseClient,
  event: SystemEventInput,
): Promise<void> {
  try {
    await supabase.from("ai_system_events").insert({
      tenant_id: event.tenantId ?? null,
      organization_id: event.organizationId ?? event.tenantId ?? null,
      user_id: event.userId ?? null,
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      actor_name: event.actorName ?? null,
      actor_role: event.actorRole ?? null,
      permission_snapshot: (event.permissionSnapshot ?? {}) as never,
      event_type: event.eventType,
      event_category: event.eventCategory,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      action: event.action ?? event.eventType,
      description: event.description ?? null,
      reason: event.reason ?? null,
      source: event.source ?? "system",
      channel: event.channel ?? null,
      ip_reference: event.ipReference ?? null,
      metadata: (event.metadata ?? {}) as never,
      severity: event.severity ?? "info",
      conversation_id: event.conversationId ?? null,
      property_id: event.propertyId ?? null,
      correlation_id: event.correlationId ?? null,
      result: event.result ?? "success",
    });
  } catch (err) {
    console.error("[audit] falha ao registrar evento", event.eventType, err);
  }
}

/** Grava vários eventos de uma vez (ex.: rastro de decisão da IA). */
export async function logSystemEvents(
  supabase: SupabaseClient,
  events: SystemEventInput[],
): Promise<void> {
  if (!events.length) return;
  for (const e of events) await logSystemEvent(supabase, e);
}

export type EventFilters = {
  tenantId?: string | null;
  userId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  eventType?: string | null;
  eventCategory?: string | null;
  channel?: string | null;
  severity?: string | null;
  conversationId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
};

export type SystemEventRow = Record<string, unknown>;

/** Consulta paginada com todos os filtros do Log Viewer. */
export async function queryEvents(
  supabase: SupabaseClient,
  filters: EventFilters,
): Promise<{ rows: SystemEventRow[]; total: number }> {
  const limit = Math.min(filters.limit ?? 50, 200);
  const offset = filters.offset ?? 0;
  let q = supabase.from("ai_system_events").select("*", { count: "exact" });

  if (filters.tenantId) q = q.eq("tenant_id", filters.tenantId);
  if (filters.userId) q = q.eq("user_id", filters.userId);
  if (filters.actorType) q = q.eq("actor_type", filters.actorType);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);
  if (filters.eventType) q = q.eq("event_type", filters.eventType);
  if (filters.eventCategory) q = q.eq("event_category", filters.eventCategory);
  if (filters.channel) q = q.eq("channel", filters.channel);
  if (filters.severity) q = q.eq("severity", filters.severity);
  if (filters.conversationId) q = q.eq("conversation_id", filters.conversationId);
  if (filters.from) q = q.gte("created_at", filters.from);
  if (filters.to) q = q.lte("created_at", filters.to);
  if (filters.search) {
    const s = filters.search.replace(/[%,]/g, " ");
    q = q.or(`description.ilike.%${s}%,actor_name.ilike.%${s}%,entity_id.ilike.%${s}%,reason.ilike.%${s}%`);
  }

  const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: (data ?? []) as SystemEventRow[], total: count ?? 0 };
}

/** Timeline de investigação: o evento + tudo que aconteceu ao redor dele. */
export async function eventTimeline(
  supabase: SupabaseClient,
  params: { eventId: string; tenantId?: string | null },
): Promise<{ event: SystemEventRow; related: SystemEventRow[] } | null> {
  let base = supabase.from("ai_system_events").select("*").eq("id", params.eventId);
  if (params.tenantId) base = base.eq("tenant_id", params.tenantId);
  const { data } = await base.maybeSingle();
  if (!data) return null;

  const event = data as SystemEventRow;
  const correlation = event.correlation_id as string | null;
  const conversation = event.conversation_id as string | null;

  let rel = supabase.from("ai_system_events").select("*").neq("id", params.eventId);
  if (correlation) rel = rel.eq("correlation_id", correlation);
  else if (conversation) rel = rel.eq("conversation_id", conversation);
  else {
    const ts = new Date(String(event.created_at)).getTime();
    rel = rel
      .gte("created_at", new Date(ts - 10 * 60_000).toISOString())
      .lte("created_at", new Date(ts + 10 * 60_000).toISOString());
    if (event.actor_id) rel = rel.eq("actor_id", event.actor_id as string);
  }

  const { data: related } = await rel.order("created_at", { ascending: true }).limit(100);
  return { event, related: (related ?? []) as SystemEventRow[] };
}

export type AuditAnalytics = {
  periodDays: number;
  total: number;
  byDay: Array<{ day: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  bySeverity: Array<{ severity: string; count: number }>;
  topActors: Array<{ actor: string; actorType: string; count: number }>;
  topAgents: Array<{ agent: string; count: number }>;
  integrationErrors: Array<{ integration: string; count: number }>;
  permissionFailures: number;
  adminChanges: number;
  learningGenerated: number;
  knowledgeApplied: number;
};

/** Indicadores da aba Analytics dentro de Logs. */
export async function auditAnalytics(
  supabase: SupabaseClient,
  params: { tenantId?: string | null; days?: number },
): Promise<AuditAnalytics> {
  const days = params.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  let q = supabase
    .from("ai_system_events")
    .select("created_at, event_category, event_type, severity, actor_type, actor_id, actor_name, metadata")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(10000);
  if (params.tenantId) q = q.eq("tenant_id", params.tenantId);

  const { data } = await q;
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const byDay = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const bySeverity = new Map<string, number>();
  const actors = new Map<string, { actorType: string; count: number }>();
  const agents = new Map<string, number>();
  const integrations = new Map<string, number>();
  let permissionFailures = 0;
  let adminChanges = 0;
  let learningGenerated = 0;
  let knowledgeApplied = 0;

  for (const r of rows) {
    const day = String(r.created_at).slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    const cat = String(r.event_category ?? "OUTRO");
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
    const sev = String(r.severity ?? "info");
    bySeverity.set(sev, (bySeverity.get(sev) ?? 0) + 1);

    const actorType = String(r.actor_type ?? "SYSTEM");
    const actorName = String(r.actor_name ?? r.actor_id ?? actorType);
    const cur = actors.get(actorName) ?? { actorType, count: 0 };
    cur.count += 1;
    actors.set(actorName, cur);

    const type = String(r.event_type ?? "");
    const meta = (r.metadata ?? {}) as Record<string, unknown>;

    if (actorType === "AI_AGENT" || type === "agent_selected") {
      const agent = String(meta.agent ?? r.actor_name ?? "generalist");
      agents.set(agent, (agents.get(agent) ?? 0) + 1);
    }
    if (type === "api_error" || (cat === "INTEGRATIONS" && r.severity === "error")) {
      const name = String(meta.integration ?? meta.provider ?? "desconhecida");
      integrations.set(name, (integrations.get(name) ?? 0) + 1);
    }
    if (type === "access_denied" || type === "permission_violation") permissionFailures += 1;
    if (cat === "PERMISSIONS" || cat === "USER_MANAGEMENT") adminChanges += 1;
    if (type === "learning_candidate_created") learningGenerated += 1;
    if (type === "learning_approved" || type === "knowledge_promoted") knowledgeApplied += 1;
  }

  const sortDesc = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

  return {
    periodDays: days,
    total: rows.length,
    byDay: [...byDay.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
    byCategory: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort(sortDesc),
    bySeverity: [...bySeverity.entries()].map(([severity, count]) => ({ severity, count })).sort(sortDesc),
    topActors: [...actors.entries()]
      .map(([actor, v]) => ({ actor, actorType: v.actorType, count: v.count }))
      .sort(sortDesc)
      .slice(0, 10),
    topAgents: [...agents.entries()].map(([agent, count]) => ({ agent, count })).sort(sortDesc).slice(0, 10),
    integrationErrors: [...integrations.entries()]
      .map(([integration, count]) => ({ integration, count }))
      .sort(sortDesc)
      .slice(0, 10),
    permissionFailures,
    adminChanges,
    learningGenerated,
    knowledgeApplied,
  };
}
