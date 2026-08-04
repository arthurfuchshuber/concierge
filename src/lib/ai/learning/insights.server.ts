/**
 * FASE 10 — Admin SaaS Insights do aprendizado.
 *
 * Learning Velocity, Knowledge Growth e saúde do conhecimento por tenant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type LearningInsights = {
  periodDays: number;
  learningVelocity: number;
  candidates: { pending: number; approved: number; rejected: number };
  knowledgeGrowth: { memoriesTotal: number; memoriesNew: number; growthPercentage: number | null };
  gaps: { open: number; recurring: number };
  approvalRate: number | null;
  avgImprovementPercentage: number | null;
  topGaps: Array<{ topic: string; occurrences: number }>;
};

export async function computeLearningInsights(params: {
  supabase: Admin;
  tenantId: string;
  days?: number;
}): Promise<LearningInsights> {
  const days = params.days ?? 30;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { supabase, tenantId } = params;

  const [pending, approved, rejected, memTotal, memNew, gapsOpen, gapsRecurring] = await Promise.all([
    count(supabase, "ai_learning_candidates", (q) => q.eq("tenant_id", tenantId).eq("approval_status", "pending")),
    count(supabase, "ai_learning_candidates", (q) =>
      q.eq("tenant_id", tenantId).eq("approval_status", "approved").gte("created_at", since),
    ),
    count(supabase, "ai_learning_candidates", (q) =>
      q.eq("tenant_id", tenantId).eq("approval_status", "rejected").gte("created_at", since),
    ),
    count(supabase, "ai_memories", (q) => q.eq("tenant_id", tenantId)),
    count(supabase, "ai_memories", (q) => q.eq("tenant_id", tenantId).gte("created_at", since)),
    count(supabase, "ai_knowledge_gaps", (q) => q.eq("tenant_id", tenantId).eq("status", "open")),
    count(supabase, "ai_knowledge_gaps", (q) => q.eq("tenant_id", tenantId).eq("status", "recurring")),
  ]);

  const { data: impacts } = await supabase
    .from("ai_learning_impact_logs")
    .select("improvement_percentage")
    .eq("tenant_id", tenantId)
    .gte("created_at", since)
    .limit(200);
  const improvements = ((impacts ?? []) as Array<Record<string, unknown>>)
    .map((r) => Number(r.improvement_percentage))
    .filter((n) => Number.isFinite(n));

  const { data: gapRows } = await supabase
    .from("ai_knowledge_gaps")
    .select("topic, occurrences")
    .eq("tenant_id", tenantId)
    .is("resolved_at", null)
    .order("occurrences", { ascending: false })
    .limit(5);

  const reviewed = approved + rejected;
  const previousTotal = memTotal - memNew;

  return {
    periodDays: days,
    learningVelocity: Number((approved / Math.max(1, days / 7)).toFixed(2)),
    candidates: { pending, approved, rejected },
    knowledgeGrowth: {
      memoriesTotal: memTotal,
      memoriesNew: memNew,
      growthPercentage: previousTotal > 0 ? Number(((memNew / previousTotal) * 100).toFixed(2)) : null,
    },
    gaps: { open: gapsOpen, recurring: gapsRecurring },
    approvalRate: reviewed > 0 ? Number((approved / reviewed).toFixed(4)) : null,
    avgImprovementPercentage: improvements.length
      ? Number((improvements.reduce((a, b) => a + b, 0) / improvements.length).toFixed(2))
      : null,
    topGaps: ((gapRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      topic: String(r.topic ?? ""),
      occurrences: Number(r.occurrences ?? 0),
    })),
  };
}

type QueryBuilder = {
  eq: (col: string, value: unknown) => QueryBuilder;
  gte: (col: string, value: unknown) => QueryBuilder;
};

async function count(
  supabase: Admin,
  table: string,
  build: (q: QueryBuilder) => QueryBuilder,
): Promise<number> {
  try {
    const base = supabase.from(table).select("id", { count: "exact", head: true });
    const query = build(base as unknown as QueryBuilder) as unknown as PromiseLike<{ count: number | null }>;
    const { count: n } = await query;
    return n ?? 0;
  } catch {
    return 0;
  }
}
