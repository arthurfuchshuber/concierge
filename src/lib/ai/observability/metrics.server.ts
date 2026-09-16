/**
 * AI Observability Platform — métricas operacionais.
 *
 * Agrega `ai_agent_logs`, `ai_operational_memory`, `ai_human_escalations` e
 * `ai_agent_evaluations` em séries persistidas em `ai_agent_metrics`.
 * Tudo é sempre calculado dentro do tenant.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MetricPeriod = "hour" | "day" | "week" | "month";

export type MetricPoint = {
  agentType: string;
  metricName: string;
  metricValue: number;
  dimension?: string | null;
  sampleSize?: number;
  metadata?: Record<string, unknown>;
};

export async function recordMetrics(params: {
  supabase: SupabaseClient;
  tenantId: string;
  propertyId?: string | null;
  period?: MetricPeriod;
  periodStart?: Date;
  points: MetricPoint[];
}): Promise<void> {
  if (!params.points.length) return;
  const period = params.period ?? "day";
  const periodStart = (params.periodStart ?? startOfPeriod(new Date(), period)).toISOString();
  try {
    await params.supabase.from("ai_agent_metrics").upsert(
      params.points.map((p) => ({
        tenant_id: params.tenantId,
        property_id: params.propertyId ?? null,
        agent_type: p.agentType,
        metric_name: p.metricName,
        metric_value: Number(p.metricValue.toFixed(6)),
        dimension: p.dimension ?? null,
        period,
        period_start: periodStart,
        sample_size: p.sampleSize ?? 1,
        metadata: (p.metadata ?? {}) as never,
      })),
      { onConflict: "tenant_id,agent_type,metric_name,dimension,period,period_start" },
    );
  } catch (err) {
    console.error("[metrics] falha ao gravar métricas", err);
  }
}

export function startOfPeriod(date: Date, period: MetricPeriod): Date {
  const d = new Date(date);
  d.setUTCMilliseconds(0);
  d.setUTCSeconds(0);
  d.setUTCMinutes(0);
  if (period === "hour") return d;
  d.setUTCHours(0);
  if (period === "day") return d;
  if (period === "week") {
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d;
  }
  d.setUTCDate(1);
  return d;
}

export type OperationalSnapshot = {
  performance: {
    avgLatencyMs: number;
    p95LatencyMs: number;
    avgToolLatencyMs: number;
    latencyByAgent: Record<string, number>;
    latencyByTool: Record<string, number>;
  };
  quality: {
    humanCorrectionRate: number;
    escalationRate: number;
    autoResolutionRate: number;
    averageConfidence: number;
    hedgedRate: number;
  };
  operations: {
    ticketsCreated: number;
    avgResolutionMinutes: number;
    recurrenceRate: number;
  };
  volume: { interactions: number; byAgent: Record<string, number>; byChannel: Record<string, number> };
};

/** Calcula o retrato operacional do período e (opcionalmente) persiste. */
export async function computeOperationalMetrics(params: {
  supabase: SupabaseClient;
  tenantId: string;
  days?: number;
  persist?: boolean;
}): Promise<OperationalSnapshot> {
  const since = new Date(Date.now() - (params.days ?? 7) * 86_400_000).toISOString();
  const { supabase, tenantId } = params;

  const [{ data: logs }, { data: ops }, { data: escalations }] = await Promise.all([
    supabase
      .from("ai_agent_logs")
      .select(
        "latency_ms, needs_human, confidence, confidence_tier, selected_agent, tools_used, channel_origin, human_response_used",
      )
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .limit(1000),
    supabase
      .from("ai_operational_memory")
      .select("resolution_minutes, recurrence_count, status")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .limit(1000),
    supabase
      .from("ai_human_escalations")
      .select("id, status")
      .eq("tenant_id", tenantId)
      .gte("created_at", since)
      .limit(1000),
  ]);

  const rows = logs ?? [];
  const total = rows.length || 1;

  const latencies = rows.map((r) => Number(r.latency_ms ?? 0)).sort((a, b) => a - b);
  const avgLatency = avg(latencies);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] ?? latencies.at(-1)! : 0;

  const latencyByAgent: Record<string, { total: number; count: number }> = {};
  const latencyByTool: Record<string, { total: number; count: number }> = {};
  const byAgent: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  let toolLatencyTotal = 0;
  let toolLatencyCount = 0;

  for (const row of rows) {
    const agent = String(row.selected_agent ?? "generalist");
    const channel = String(row.channel_origin ?? "guide_chat");
    byAgent[agent] = (byAgent[agent] ?? 0) + 1;
    byChannel[channel] = (byChannel[channel] ?? 0) + 1;
    const la = (latencyByAgent[agent] ??= { total: 0, count: 0 });
    la.total += Number(row.latency_ms ?? 0);
    la.count += 1;

    const tools = Array.isArray(row.tools_used) ? (row.tools_used as Array<Record<string, unknown>>) : [];
    for (const tool of tools) {
      const name = String(tool.name ?? "unknown");
      const ms = Number(tool.durationMs ?? 0);
      const lt = (latencyByTool[name] ??= { total: 0, count: 0 });
      lt.total += ms;
      lt.count += 1;
      toolLatencyTotal += ms;
      toolLatencyCount += 1;
    }
  }

  const needsHuman = rows.filter((r) => r.needs_human).length;
  const hedged = rows.filter((r) => r.confidence_tier === "hedged").length;
  const humanUsed = rows.filter((r) => r.human_response_used).length;
  const confidences = rows.map((r) => Number(r.confidence ?? 0)).filter((n) => n > 0);

  const opRows = ops ?? [];
  const resolutions = opRows
    .map((r) => Number(r.resolution_minutes ?? 0))
    .filter((n) => n > 0);
  const recurrences = opRows.filter((r) => Number(r.recurrence_count ?? 0) > 1).length;

  const snapshot: OperationalSnapshot = {
    performance: {
      avgLatencyMs: Math.round(avgLatency),
      p95LatencyMs: Math.round(p95),
      avgToolLatencyMs: toolLatencyCount ? Math.round(toolLatencyTotal / toolLatencyCount) : 0,
      latencyByAgent: mapAvg(latencyByAgent),
      latencyByTool: mapAvg(latencyByTool),
    },
    quality: {
      humanCorrectionRate: round(humanUsed / total),
      escalationRate: round(needsHuman / total),
      autoResolutionRate: round((total - needsHuman) / total),
      averageConfidence: round(avg(confidences)),
      hedgedRate: round(hedged / total),
    },
    operations: {
      ticketsCreated: opRows.length,
      avgResolutionMinutes: Math.round(avg(resolutions)),
      recurrenceRate: opRows.length ? round(recurrences / opRows.length) : 0,
    },
    volume: { interactions: rows.length, byAgent, byChannel },
  };

  if (params.persist !== false) {
    const points: MetricPoint[] = [
      { agentType: "all", metricName: "avg_latency_ms", metricValue: snapshot.performance.avgLatencyMs, sampleSize: rows.length },
      { agentType: "all", metricName: "p95_latency_ms", metricValue: snapshot.performance.p95LatencyMs, sampleSize: rows.length },
      { agentType: "all", metricName: "escalation_rate", metricValue: snapshot.quality.escalationRate, sampleSize: rows.length },
      { agentType: "all", metricName: "auto_resolution_rate", metricValue: snapshot.quality.autoResolutionRate, sampleSize: rows.length },
      { agentType: "all", metricName: "avg_confidence", metricValue: snapshot.quality.averageConfidence, sampleSize: rows.length },
      { agentType: "all", metricName: "human_correction_rate", metricValue: snapshot.quality.humanCorrectionRate, sampleSize: rows.length },
      { agentType: "all", metricName: "tickets_created", metricValue: snapshot.operations.ticketsCreated, sampleSize: opRows.length },
      { agentType: "all", metricName: "avg_resolution_minutes", metricValue: snapshot.operations.avgResolutionMinutes, sampleSize: resolutions.length },
      { agentType: "all", metricName: "recurrence_rate", metricValue: snapshot.operations.recurrenceRate, sampleSize: opRows.length },
      { agentType: "all", metricName: "pending_escalations", metricValue: (escalations ?? []).filter((e) => e.status === "pending").length },
    ];
    for (const [agent, count] of Object.entries(byAgent)) {
      points.push({ agentType: agent, metricName: "interactions", metricValue: count, sampleSize: count });
      points.push({
        agentType: agent,
        metricName: "avg_latency_ms",
        metricValue: snapshot.performance.latencyByAgent[agent] ?? 0,
        sampleSize: count,
      });
    }
    for (const [tool, value] of Object.entries(snapshot.performance.latencyByTool)) {
      points.push({ agentType: "all", metricName: "tool_latency_ms", metricValue: value, dimension: tool });
    }
    await recordMetrics({ supabase, tenantId, points });
  }

  return snapshot;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function round(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(4));
}
function mapAvg(input: Record<string, { total: number; count: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input)) out[k] = Math.round(v.total / Math.max(1, v.count));
  return out;
}
