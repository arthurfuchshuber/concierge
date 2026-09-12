/**
 * FASE 9 — Learning Feedback Loop (medição de impacto).
 *
 * Depois que um aprendizado é aplicado, comparamos a performance antes e
 * depois no mesmo escopo, registrando o ganho real em `ai_learning_impact_logs`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type ImpactResult = {
  learningId: string;
  metric: string;
  before: number | null;
  after: number | null;
  improvementPercentage: number | null;
  sampleBefore: number;
  sampleAfter: number;
};

/** Mede o impacto de todos os aprendizados aplicados há pelo menos `minDays`. */
export async function measureLearningImpact(params: {
  supabase: Admin;
  tenantId: string;
  minDays?: number;
  windowDays?: number;
}): Promise<ImpactResult[]> {
  const minDays = params.minDays ?? 3;
  const windowDays = params.windowDays ?? 14;
  const cutoff = new Date(Date.now() - minDays * 86_400_000).toISOString();

  const { data: applied } = await params.supabase
    .from("ai_learning_candidates")
    .select("id, property_id, applied_at")
    .eq("tenant_id", params.tenantId)
    .eq("approval_status", "approved")
    .not("applied_at", "is", null)
    .lte("applied_at", cutoff)
    .order("applied_at", { ascending: false })
    .limit(20);

  const out: ImpactResult[] = [];
  for (const row of (applied ?? []) as Array<Record<string, unknown>>) {
    const appliedAt = new Date(String(row.applied_at));
    const before = await resolutionRate(params.supabase, params.tenantId, row.property_id as string | null, {
      from: new Date(appliedAt.getTime() - windowDays * 86_400_000),
      to: appliedAt,
    });
    const after = await resolutionRate(params.supabase, params.tenantId, row.property_id as string | null, {
      from: appliedAt,
      to: new Date(Math.min(Date.now(), appliedAt.getTime() + windowDays * 86_400_000)),
    });

    const improvement =
      before.rate == null || after.rate == null || before.rate === 0
        ? null
        : ((after.rate - before.rate) / before.rate) * 100;

    const result: ImpactResult = {
      learningId: String(row.id),
      metric: "resolution_rate",
      before: before.rate,
      after: after.rate,
      improvementPercentage: improvement == null ? null : Number(improvement.toFixed(2)),
      sampleBefore: before.n,
      sampleAfter: after.n,
    };
    out.push(result);

    try {
      await params.supabase.from("ai_learning_impact_logs").insert({
        tenant_id: params.tenantId,
        owner_id: params.tenantId,
        learning_id: result.learningId,
        metric: result.metric,
        metric_before: result.before,
        metric_after: result.after,
        improvement_percentage: result.improvementPercentage,
        sample_before: result.sampleBefore,
        sample_after: result.sampleAfter,
      });
    } catch (err) {
      console.error("[learning:impact] falha ao gravar impacto", err);
    }
  }
  return out;
}

async function resolutionRate(
  supabase: Admin,
  tenantId: string,
  propertyId: string | null,
  range: { from: Date; to: Date },
): Promise<{ rate: number | null; n: number }> {
  try {
    let q = supabase
      .from("ai_agent_logs")
      .select("needs_human")
      .eq("tenant_id", tenantId)
      .gte("created_at", range.from.toISOString())
      .lt("created_at", range.to.toISOString())
      .limit(3000);
    if (propertyId) q = q.eq("property_id", propertyId);
    const { data } = await q;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) return { rate: null, n: 0 };
    const resolved = rows.filter((r) => r.needs_human !== true).length;
    return { rate: Number((resolved / rows.length).toFixed(4)), n: rows.length };
  } catch {
    return { rate: null, n: 0 };
  }
}
