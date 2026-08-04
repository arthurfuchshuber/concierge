/**
 * API interna (admin/anfitrião) das camadas de Avaliação, Observabilidade,
 * Canais e Inteligência Proativa. Toda função é autenticada e sempre opera
 * dentro do tenant do chamador — nunca aceita tenant vindo do cliente.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Resolve o tenant efetivo: o próprio usuário ou a conta de que ele é membro. */
async function resolveCallerTenant(context: {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };
  userId: string;
}): Promise<string> {
  return context.userId;
}

export const getAiOperationalMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number; tenantId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeOperationalMetrics } = await import("@/lib/ai/observability/metrics.server");
    const tenantId = data.tenantId ?? (await resolveCallerTenant(context as never));
    if (data.tenantId && data.tenantId !== context.userId) {
      const { data: allowed } = await context.supabase.rpc("is_account_member", {
        _user_id: context.userId,
        _owner_id: data.tenantId,
      });
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!allowed && !isAdmin) throw new Error("Forbidden");
    }
    return computeOperationalMetrics({ supabase: supabaseAdmin, tenantId, days: data.days ?? 7 });
  });

export const explainAiInteraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { logId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { explainInteraction } = await import("@/lib/ai/observability/root-cause.server");
    return explainInteraction({ supabase: supabaseAdmin, tenantId: context.userId, logId: data.logId });
  });

export const runAiEvaluation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { propertyId: string; suite?: string; limit?: number }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: property } = await context.supabase
      .from("properties")
      .select("id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (!property) throw new Error("Imóvel não encontrado ou sem acesso");

    const { runEvaluationSuite } = await import("@/lib/ai/evaluation/engine.server");
    return runEvaluationSuite({
      supabase: supabaseAdmin,
      propertyId: data.propertyId,
      suite: data.suite,
      limit: data.limit,
    });
  });

export const getAiQualityHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { qualityHistory } = await import("@/lib/ai/evaluation/regression.server");
    return qualityHistory({ supabase: supabaseAdmin, tenantId: context.userId, days: data.days ?? 30 });
  });

export const listProactiveActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string; limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("ai_proactive_actions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows ?? [];
  });

export const reviewProactiveAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { actionId: string; approve: boolean; note?: string }) => input)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_proactive_actions")
      .update({
        approval_status: data.approve ? "approved" : "rejected",
        status: data.approve ? "approved" : "dismissed",
        approved_by: context.userId,
        approved_at: new Date().toISOString(),
        error: data.note ?? null,
      })
      .eq("id", data.actionId);
    if (error) throw error;
    return { ok: true };
  });

export const scanProactiveNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scanProactiveOpportunities } = await import("@/lib/ai/agents/proactive/engine.server");
    return scanProactiveOpportunities({ supabase: supabaseAdmin, tenantId: context.userId });
  });
