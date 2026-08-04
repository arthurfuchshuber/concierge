/**
 * API interna do Continuous Learning Loop.
 *
 * Toda função é autenticada e opera dentro do tenant do chamador. Aprovação de
 * conhecimento é sempre humana e registra o revisor.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Garante que o chamador pode operar no tenant pedido. */
async function assertTenantAccess(
  context: { supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> }; userId: string },
  tenantId?: string,
): Promise<string> {
  if (!tenantId || tenantId === context.userId) return context.userId;
  const { data: allowed } = await context.supabase.rpc("is_account_member", {
    _user_id: context.userId,
    _owner_id: tenantId,
  });
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!allowed && !isAdmin) throw new Error("Forbidden");
  return tenantId;
}

export const getLearningInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string; days?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeLearningInsights } = await import("@/lib/ai/learning/insights.server");
    return computeLearningInsights({ supabase: supabaseAdmin, tenantId, days: data.days ?? 30 });
  });

export const listLearningQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string; status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listLearningCandidates } = await import("@/lib/ai/learning/candidates.server");
    return listLearningCandidates({ supabase: supabaseAdmin, tenantId, status: data.status ?? "pending" });
  });

export const reviewLearningCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      candidateId: string;
      action: "approve" | "reject";
      tenantId?: string;
      approvedScope?: "reservation" | "property" | "owner_portfolio" | "company_global" | "temporary_exception";
      editedContent?: string | null;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { approveAndApply, rejectCandidate } = await import("@/lib/ai/learning/candidates.server");
    if (data.action === "reject") {
      return rejectCandidate({
        supabase: supabaseAdmin,
        candidateId: data.candidateId,
        tenantId,
        reviewerId: context.userId,
      });
    }
    return approveAndApply({
      supabase: supabaseAdmin,
      candidateId: data.candidateId,
      tenantId,
      reviewerId: context.userId,
      approvedScope: data.approvedScope,
      editedContent: data.editedContent ?? null,
    });
  });

export const listAiKnowledgeGaps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listKnowledgeGaps } = await import("@/lib/ai/learning/gaps.server");
    return listKnowledgeGaps({ supabase: supabaseAdmin, tenantId });
  });

export const resolveAiKnowledgeGap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { gapId: string; tenantId?: string }) => input)
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveKnowledgeGap } = await import("@/lib/ai/learning/gaps.server");
    await resolveKnowledgeGap({ supabase: supabaseAdmin, tenantId, gapId: data.gapId });
    return { ok: true };
  });

export const listAiPromptSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listPromptSuggestions } = await import("@/lib/ai/learning/prompt-optimizer.server");
    return listPromptSuggestions({ supabase: supabaseAdmin, tenantId });
  });

export const reviewAiPromptSuggestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { suggestionId: string; status: "approved" | "rejected"; tenantId?: string }) => input)
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reviewPromptSuggestion } = await import("@/lib/ai/learning/prompt-optimizer.server");
    await reviewPromptSuggestion({
      supabase: supabaseAdmin,
      tenantId,
      suggestionId: data.suggestionId,
      reviewerId: context.userId,
      status: data.status,
    });
    return { ok: true };
  });

export const getAgentLearningMetrics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string; days?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenantAccess(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { refreshAgentLearningMetrics } = await import("@/lib/ai/learning/agent-performance.server");
    return refreshAgentLearningMetrics({ supabase: supabaseAdmin, tenantId, days: data.days ?? 7 });
  });
