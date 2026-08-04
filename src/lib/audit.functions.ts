/**
 * API interna do Enterprise Audit Trail.
 *
 * Cliente enxerga somente os eventos do próprio tenant. Equipe da plataforma
 * (role admin) enxerga todos e pode filtrar por tenant.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };
  userId: string;
};

async function isPlatformAdmin(context: Ctx): Promise<boolean> {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  return data === true;
}

/** Tenant efetivo: admin pode escolher, cliente só o próprio (ou conta de que é membro). */
async function resolveScope(context: Ctx, tenantId?: string | null): Promise<string | null> {
  if (await isPlatformAdmin(context)) return tenantId ?? null;
  if (!tenantId || tenantId === context.userId) return context.userId;
  const { data: allowed } = await context.supabase.rpc("is_account_member", {
    _user_id: context.userId,
    _owner_id: tenantId,
  });
  if (!allowed) throw new Error("Forbidden");
  return tenantId;
}

export type AuditFilterInput = {
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

export const listSystemEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AuditFilterInput | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await resolveScope(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { queryEvents } = await import("@/lib/ai/audit/events.server");
    return queryEvents(supabaseAdmin, { ...data, tenantId });
  });

export const getSystemEventTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { eventId: string; tenantId?: string | null }) => input)
  .handler(async ({ data, context }) => {
    const tenantId = await resolveScope(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { eventTimeline } = await import("@/lib/ai/audit/events.server");
    return eventTimeline(supabaseAdmin, { eventId: data.eventId, tenantId });
  });

export const getAuditAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string | null; days?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await resolveScope(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { auditAnalytics } = await import("@/lib/ai/audit/events.server");
    return auditAnalytics(supabaseAdmin, { tenantId, days: data.days ?? 30 });
  });

/** Lista de tenants para o filtro do painel SaaS. */
export const listAuditTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await isPlatformAdmin(context as never))) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .order("full_name", { ascending: true })
      .limit(500);
    return ((data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      id: String(p.id),
      name: String(p.full_name || p.id),
    }));
  });

/** Registra eventos originados no cliente (login, logout, negação de acesso). */
export const recordClientEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      eventType: string;
      eventCategory:
        | "AUTHENTICATION"
        | "PERMISSIONS"
        | "USER_MANAGEMENT"
        | "CONVERSATION"
        | "AI_DECISION"
        | "MEMORY"
        | "LEARNING"
        | "INTEGRATIONS"
        | "SECURITY";
      description?: string;
      reason?: string;
      entityType?: string;
      entityId?: string;
      severity?: "info" | "notice" | "warning" | "error" | "critical";
      metadata?: Record<string, unknown>;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvent } = await import("@/lib/ai/audit/events.server");
    const admin = await isPlatformAdmin(context as never);
    await logSystemEvent(supabaseAdmin, {
      tenantId: context.userId,
      userId: context.userId,
      actorType: admin ? "ADMIN" : "USER",
      actorId: context.userId,
      actorName: (context.claims as Record<string, unknown> | undefined)?.["email"] as string | undefined,
      actorRole: admin ? "admin" : "host",
      eventType: data.eventType,
      eventCategory: data.eventCategory,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      description: data.description ?? null,
      reason: data.reason ?? null,
      severity: data.severity ?? "info",
      source: "web_app",
      metadata: data.metadata ?? {},
    });
    return { ok: true };
  });
