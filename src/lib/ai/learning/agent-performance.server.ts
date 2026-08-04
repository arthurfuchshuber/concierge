/**
 * FASE 5 — Agent Performance Learning.
 *
 * Consolida, por agente especialista, como a performance evolui ao longo do
 * tempo (resolução, confiança, escalonamento, qualidade) em
 * `ai_agent_learning_metrics`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type AgentMetricRow = {
  agent: string;
  metric: string;
  value: number;
  previousValue: number | null;
  trend: "up" | "down" | "flat";
  sampleSize: number;
};

const METRICS = ["resolution_rate", "avg_confidence", "escalation_rate", "human_dependency"] as const;

/** Calcula e persiste as métricas de aprendizado por agente. */
export async function refreshAgentLearningMetrics(params: {
  supabase: Admin;
  tenantId: string;
  ownerId?: string | null;
  days?: number;
}): Promise<AgentMetricRow[]> {
  const days = params.days ?? 7;
  const periodStart = new Date(Date.now() - days * 86_400_000);
  const previousStart = new Date(Date.now() - 2 * days * 86_400_000);

  const current = await aggregate(params.supabase, params.tenantId, periodStart, new Date());
  const previous = await aggregate(params.supabase, params.tenantId, previousStart, periodStart);

  const out: AgentMetricRow[] = [];
  for (const [agent, cur] of current) {
    const prev = previous.get(agent);
    for (const metric of METRICS) {
      const value = cur[metric];
      const previousValue = prev ? prev[metric] : null;
      const trend: AgentMetricRow["trend"] =
        previousValue == null || Math.abs(value - previousValue) < 0.02
          ? "flat"
          : value > previousValue
            ? "up"
            : "down";

      out.push({ agent, metric, value, previousValue, trend, sampleSize: cur.sampleSize });

      try {
        await params.supabase.from("ai_agent_learning_metrics").insert({
          tenant_id: params.tenantId,
          owner_id: params.ownerId ?? params.tenantId,
          agent_type: agent,
          metric,
          value: Number(value.toFixed(4)),
          previous_value: previousValue == null ? null : Number(previousValue.toFixed(4)),
          trend,
          period: `${days}d`,
          period_start: periodStart.toISOString(),
          sample_size: cur.sampleSize,
        });
      } catch (err) {
        console.error("[learning:agent-metrics] falha ao gravar métrica", err);
      }
    }
  }
  return out;
}

type Agg = Record<(typeof METRICS)[number], number> & { sampleSize: number };

async function aggregate(
  supabase: Admin,
  tenantId: string,
  from: Date,
  to: Date,
): Promise<Map<string, Agg>> {
  const map = new Map<string, Agg>();
  try {
    const { data } = await supabase
      .from("ai_agent_logs")
      .select("selected_agent, confidence, needs_human, escalation_triggered, human_response_used")
      .eq("tenant_id", tenantId)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString())
      .limit(5000);

    const buckets = new Map<
      string,
      { n: number; conf: number; needsHuman: number; escalated: number; humanUsed: number }
    >();

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const agent = String(row.selected_agent ?? "generalist");
      const b = buckets.get(agent) ?? { n: 0, conf: 0, needsHuman: 0, escalated: 0, humanUsed: 0 };
      b.n += 1;
      b.conf += Number(row.confidence ?? 0) || 0;
      if (row.needs_human === true) b.needsHuman += 1;
      if (row.escalation_triggered === true) b.escalated += 1;
      if (row.human_response_used === true) b.humanUsed += 1;
      buckets.set(agent, b);
    }

    for (const [agent, b] of buckets) {
      map.set(agent, {
        resolution_rate: 1 - b.needsHuman / Math.max(1, b.n),
        avg_confidence: b.conf / Math.max(1, b.n),
        escalation_rate: b.escalated / Math.max(1, b.n),
        human_dependency: b.humanUsed / Math.max(1, b.n),
        sampleSize: b.n,
      });
    }
  } catch (err) {
    console.error("[learning:agent-metrics] falha ao agregar", err);
  }
  return map;
}
