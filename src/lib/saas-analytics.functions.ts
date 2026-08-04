import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Period, SaasAnalytics } from "@/lib/ai/analytics/engine.server";

const PERIOD = z.object({ period: z.enum(["today", "7d", "30d", "90d"]).default("30d") });

async function assertAdmin(supabase: any, userId: string): Promise<void> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Acesso restrito a administradores da plataforma");
}

/** Painel SaaS: métricas estratégicas consolidadas. */
export const getSaasAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => PERIOD.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<SaasAnalytics> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeSaasAnalytics } = await import("@/lib/ai/analytics/engine.server");
    return computeSaasAnalytics(supabaseAdmin, data.period as Period);
  });

export type SaasAlert = {
  id: string;
  tenantId: string | null;
  propertyId: string | null;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  status: string;
  createdAt: string;
};

export const listSaasAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ status: z.enum(["open", "acknowledged", "all"]).default("open") }).parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<SaasAlert[]> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("ai_alerts")
      .select("id, tenant_id, property_id, kind, severity, title, detail, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows } = await q;
    return (rows ?? []).map((r) => ({
      id: String(r.id),
      tenantId: (r.tenant_id as string | null) ?? null,
      propertyId: (r.property_id as string | null) ?? null,
      kind: String(r.kind),
      severity: String(r.severity),
      title: String(r.title),
      detail: (r.detail as string | null) ?? null,
      status: String(r.status),
      createdAt: String(r.created_at),
    }));
  });

export const acknowledgeSaasAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("ai_alerts")
      .update({ status: "acknowledged", acknowledged_by: userId, acknowledged_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Executa o motor de alertas sob demanda. */
export const runAlertScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { generateAlerts } = await import("@/lib/ai/alerts/engine.server");
    return generateAlerts(supabaseAdmin);
  });
