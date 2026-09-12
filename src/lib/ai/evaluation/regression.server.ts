/**
 * Regression Testing.
 *
 * Compara cada execução de cenário com a última execução registrada do mesmo
 * caso no mesmo tenant. Toda mudança de prompt, modelo, ferramenta, regra de
 * agente ou memória passa por aqui antes de ir para produção.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const TOLERANCE = 0.03;

export type RegressionVerdict = "baseline" | "improved" | "regressed" | "stable" | "behavior_change";

export async function compareWithBaseline(params: {
  supabase: SupabaseClient;
  tenantId: string;
  testCaseName: string;
  quality: number;
  actualAgent?: string;
}): Promise<{ result: RegressionVerdict; baselineId: string | null; delta: number }> {
  const { data } = await params.supabase
    .from("ai_agent_evaluations")
    .select("id, quality_score, actual_agent")
    .eq("tenant_id", params.tenantId)
    .eq("test_case_name", params.testCaseName)
    .order("created_at", { ascending: false })
    .limit(1);

  const baseline = data?.[0];
  if (!baseline) return { result: "baseline", baselineId: null, delta: 0 };

  const previous = Number(baseline.quality_score ?? 0);
  const delta = Number((params.quality - previous).toFixed(4));

  if (params.actualAgent && baseline.actual_agent && params.actualAgent !== baseline.actual_agent) {
    return { result: "behavior_change", baselineId: baseline.id, delta };
  }
  if (delta > TOLERANCE) return { result: "improved", baselineId: baseline.id, delta };
  if (delta < -TOLERANCE) return { result: "regressed", baselineId: baseline.id, delta };
  return { result: "stable", baselineId: baseline.id, delta };
}

/** Resumo de uma rodada completa: o que melhorou, o que regrediu, o que mudou. */
export async function summarizeRun(
  supabase: SupabaseClient,
  runId: string,
): Promise<{
  runId: string;
  improved: string[];
  regressed: string[];
  behaviorChanged: string[];
  stable: string[];
  averageQuality: number;
}> {
  const { data } = await supabase
    .from("ai_agent_evaluations")
    .select("test_case_name, regression_result, quality_score")
    .eq("run_id", runId);

  const rows = data ?? [];
  const pick = (r: string) =>
    rows.filter((x) => x.regression_result === r).map((x) => x.test_case_name as string);

  const avg = rows.length
    ? Number((rows.reduce((s, r) => s + Number(r.quality_score ?? 0), 0) / rows.length).toFixed(4))
    : 0;

  return {
    runId,
    improved: pick("improved"),
    regressed: pick("regressed"),
    behaviorChanged: pick("behavior_change"),
    stable: pick("stable"),
    averageQuality: avg,
  };
}

/** Histórico de evolução da qualidade por agente. */
export async function qualityHistory(params: {
  supabase: SupabaseClient;
  tenantId: string;
  days?: number;
}): Promise<Array<{ date: string; agent: string; quality: number; samples: number }>> {
  const since = new Date(Date.now() - (params.days ?? 30) * 86_400_000).toISOString();
  const { data } = await params.supabase
    .from("ai_agent_evaluations")
    .select("created_at, actual_agent, quality_score")
    .eq("tenant_id", params.tenantId)
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const buckets = new Map<string, { total: number; count: number }>();
  for (const row of data ?? []) {
    const date = String(row.created_at).slice(0, 10);
    const key = `${date}|${row.actual_agent ?? "unknown"}`;
    const b = buckets.get(key) ?? { total: 0, count: 0 };
    b.total += Number(row.quality_score ?? 0);
    b.count += 1;
    buckets.set(key, b);
  }

  return [...buckets.entries()].map(([key, b]) => {
    const [date, agent] = key.split("|");
    return {
      date: date!,
      agent: agent!,
      quality: Number((b.total / b.count).toFixed(4)),
      samples: b.count,
    };
  });
}
