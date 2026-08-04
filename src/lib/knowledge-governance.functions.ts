/**
 * API interna da Knowledge Governance.
 *
 * Painel do cliente: Memória da Operação, Conhecimento da Operação e
 * Aprendizados Pendentes. Admin SaaS: Global Intelligence e pipeline.
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

async function assertTenant(context: Ctx, tenantId?: string | null): Promise<string> {
  if (!tenantId || tenantId === context.userId) return context.userId;
  const { data: allowed } = await context.supabase.rpc("is_account_member", {
    _user_id: context.userId,
    _owner_id: tenantId,
  });
  if (allowed === true) return tenantId;
  if (await isPlatformAdmin(context)) return tenantId;
  throw new Error("Forbidden");
}

async function requireAdmin(context: Ctx): Promise<void> {
  if (!(await isPlatformAdmin(context))) throw new Error("Forbidden");
}

/* ------------------------------------------------------------------ */
/* Painel do cliente                                                    */
/* ------------------------------------------------------------------ */

export const listOperationMemoryInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenant(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listOperationMemory } = await import("@/lib/ai/governance/tenant-knowledge.server");
    return listOperationMemory({ supabase: supabaseAdmin, tenantId });
  });

export type TenantKnowledgeRow = {
  id: string;
  title: string;
  category: string;
  content: string;
  knowledge_scope: string;
  priority: number;
  status: string;
  property_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string;
};

export const listOperationKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId?: string; status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<TenantKnowledgeRow[]> => {
    const tenantId = await assertTenant(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listTenantKnowledge } = await import("@/lib/ai/governance/tenant-knowledge.server");
    const rows = await listTenantKnowledge({ supabase: supabaseAdmin, tenantId, status: data.status });
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      category: String(r.category ?? "geral"),
      content: String(r.content ?? ""),
      knowledge_scope: String(r.knowledge_scope ?? "TENANT_KNOWLEDGE"),
      priority: Number(r.priority ?? 3),
      status: String(r.status ?? "active"),
      property_id: (r.property_id as string) ?? null,
      author_name: (r.author_name as string) ?? null,
      created_at: String(r.created_at ?? ""),
      updated_at: String(r.updated_at ?? ""),
    }));
  });

export const saveOperationKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      tenantId?: string;
      id?: string | null;
      title: string;
      category: string;
      content: string;
      knowledgeScope: "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE";
      priority: number;
      propertyId?: string | null;
      status?: "active" | "archived";
    }) => {
      if (!input.title?.trim()) throw new Error("Informe um título");
      if (!input.content?.trim()) throw new Error("Informe o conteúdo");
      if (input.title.length > 200) throw new Error("Título muito longo");
      if (input.content.length > 8000) throw new Error("Conteúdo muito longo");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenant(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { upsertTenantKnowledge } = await import("@/lib/ai/governance/tenant-knowledge.server");
    const email = ((context.claims as Record<string, unknown> | undefined)?.["email"] as string) ?? null;
    await upsertTenantKnowledge({
      supabase: supabaseAdmin,
      tenantId,
      actorId: context.userId,
      actorName: email,
      actorRole: null,
      id: data.id ?? null,
      input: {
        title: data.title,
        category: data.category,
        content: data.content,
        knowledgeScope: data.knowledgeScope,
        priority: data.priority,
        propertyId: data.propertyId ?? null,
        status: data.status,
      },
    });
    return { ok: true };
  });

export const archiveOperationKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; tenantId?: string }) => input)
  .handler(async ({ data, context }) => {
    const tenantId = await assertTenant(context as never, data.tenantId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { archiveTenantKnowledge } = await import("@/lib/ai/governance/tenant-knowledge.server");
    const email = ((context.claims as Record<string, unknown> | undefined)?.["email"] as string) ?? null;
    await archiveTenantKnowledge({
      supabase: supabaseAdmin,
      tenantId,
      actorId: context.userId,
      actorName: email,
      id: data.id,
    });
    return { ok: true };
  });

/* ------------------------------------------------------------------ */
/* Admin SaaS — Melhoria da IA                                          */
/* ------------------------------------------------------------------ */

export type GlobalInsightRow = {
  id: string;
  title: string;
  insight: string;
  category: string;
  confidence: number;
  impact_estimate: string | null;
  impact_percentage: number | null;
  source_conversations: number;
  source_tenants: number;
  status: string;
  created_at: string;
};

export const listGlobalInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<GlobalInsightRow[]> => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listGlobalIntelligence } = await import("@/lib/ai/governance/global-intelligence.server");
    const rows = await listGlobalIntelligence({ supabase: supabaseAdmin, status: data.status });
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      insight: String(r.insight ?? ""),
      category: String(r.category ?? ""),
      confidence: Number(r.confidence ?? 0),
      impact_estimate: (r.impact_estimate as string) ?? null,
      impact_percentage: r.impact_percentage == null ? null : Number(r.impact_percentage),
      source_conversations: Number(r.source_conversations ?? 0),
      source_tenants: Number(r.source_tenants ?? 0),
      status: String(r.status ?? "draft"),
      created_at: String(r.created_at ?? ""),
    }));
  });

export const saveGlobalInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string | null;
      title: string;
      insight: string;
      category: string;
      confidence: number;
      impactEstimate?: string | null;
      impactPercentage?: number | null;
      sourceConversations?: number;
      sourceTenants?: number;
      status?: "draft" | "published" | "archived";
    }) => {
      if (!input.title?.trim()) throw new Error("Informe um título");
      if (!input.insight?.trim()) throw new Error("Informe o insight");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { upsertGlobalIntelligence } = await import("@/lib/ai/governance/global-intelligence.server");
    const email = ((context.claims as Record<string, unknown> | undefined)?.["email"] as string) ?? null;
    await upsertGlobalIntelligence({
      supabase: supabaseAdmin,
      actorId: context.userId,
      actorName: email,
      id: data.id ?? null,
      input: data,
    });
    return { ok: true };
  });

export type PipelineRow = {
  id: string;
  tenant_id: string | null;
  title: string | null;
  content: string;
  learning_type: string | null;
  category: string | null;
  confidence: number | null;
  approval_status: string;
  suggested_scope: string | null;
  approved_scope: string | null;
  source_conversation_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
  promoted_global_id: string | null;
  estimated_impact: string | null;
};

export const listLearningPipeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<PipelineRow[]> => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { learningPipeline } = await import("@/lib/ai/governance/global-intelligence.server");
    const rows = await learningPipeline({ supabase: supabaseAdmin, status: data.status });
    return rows.map((r) => ({
      id: String(r.id),
      tenant_id: (r.tenant_id as string) ?? null,
      title: (r.title as string) ?? null,
      content: String(r.extracted_information ?? r.proposed_memory ?? ""),
      learning_type: (r.learning_type as string) ?? null,
      category: (r.category as string) ?? null,
      confidence: r.confidence == null ? null : Number(r.confidence),
      approval_status: String(r.approval_status ?? "pending"),
      suggested_scope: (r.suggested_scope as string) ?? null,
      approved_scope: (r.approved_scope as string) ?? null,
      source_conversation_id: (r.source_conversation_id as string) ?? null,
      created_at: String(r.created_at ?? ""),
      reviewed_at: (r.reviewed_at as string) ?? null,
      applied_at: (r.applied_at as string) ?? null,
      promoted_global_id: (r.promoted_global_id as string) ?? null,
      estimated_impact: (r.estimated_impact as string) ?? null,
    }));
  });

export const promoteLearningToGlobal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateId: string }) => input)
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { promoteCandidateToGlobal } = await import("@/lib/ai/governance/global-intelligence.server");
    const email = ((context.claims as Record<string, unknown> | undefined)?.["email"] as string) ?? null;
    await promoteCandidateToGlobal({
      supabase: supabaseAdmin,
      candidateId: data.candidateId,
      actorId: context.userId,
      actorName: email,
    });
    return { ok: true };
  });

export const getAgentImprovement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { agentImprovementOverview } = await import("@/lib/ai/governance/global-intelligence.server");
    return agentImprovementOverview({ supabase: supabaseAdmin, days: data.days ?? 30 });
  });

export type PromptSuggestionRow = {
  id: string;
  prompt_key: string;
  prompt_version: string | null;
  suggestion: string;
  reason: string | null;
  expected_impact: string | null;
  confidence: number | null;
  sample_size: number | null;
  status: string;
  created_at: string;
};

export const listPromptEvolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<PromptSuggestionRow[]> => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("ai_prompt_change_candidates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      prompt_key: String(r.prompt_key ?? ""),
      prompt_version: (r.prompt_version as string) ?? null,
      suggestion: String(r.suggestion ?? ""),
      reason: (r.reason as string) ?? null,
      expected_impact: (r.expected_impact as string) ?? null,
      confidence: r.confidence == null ? null : Number(r.confidence),
      sample_size: r.sample_size == null ? null : Number(r.sample_size),
      status: String(r.status ?? "pending"),
      created_at: String(r.created_at ?? ""),
    }));
  });

export const reviewPromptEvolution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "rejected" }) => input)
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logSystemEvent } = await import("@/lib/ai/audit/events.server");
    const { error } = await supabaseAdmin
      .from("ai_prompt_change_candidates")
      .update({ status: data.status, reviewed_by: context.userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw error;
    await logSystemEvent(supabaseAdmin, {
      actorType: "ADMIN",
      actorId: context.userId,
      userId: context.userId,
      actorRole: "admin",
      eventType: data.status === "approved" ? "learning_approved" : "learning_rejected",
      eventCategory: "LEARNING",
      entityType: "ai_prompt_change_candidates",
      entityId: data.id,
      description: `Sugestão de prompt ${data.status === "approved" ? "aprovada" : "rejeitada"}`,
      reason: "Revisão humana obrigatória — prompts nunca mudam automaticamente",
      source: "saas_admin",
    });
    return { ok: true };
  });
