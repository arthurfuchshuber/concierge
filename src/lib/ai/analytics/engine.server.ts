/**
 * SaaS Analytics Engine.
 *
 * Consolida IA, atendimento, operação, clientes, custos e receita em métricas
 * estratégicas para o administrador da plataforma. Somente leitura — nunca
 * altera dados operacionais.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Period = "today" | "7d" | "30d" | "90d";

export function periodStart(period: Period): string {
  const now = new Date();
  const days = period === "today" ? 0 : period === "7d" ? 7 : period === "30d" ? 30 : 90;
  if (days === 0) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export type SaasAnalytics = {
  period: Period;
  since: string;
  usage: {
    activeTenants: number;
    connectedProperties: number;
    guestsServed: number;
    conversations: number;
    messages: number;
    byChannel: Record<string, number>;
    activeUsersByTenant: Array<{ tenantId: string; users: number }>;
  };
  ai: {
    interactions: number;
    resolutionRate: number;
    escalationRate: number;
    avgConfidence: number;
    reflectionQuality: number;
    avgLatencyMs: number;
    agentPerformance: Array<{ agent: string; runs: number; resolutionRate: number; avgConfidence: number; avgLatencyMs: number }>;
  };
  operations: {
    ticketsCreated: number;
    ticketsResolved: number;
    avgResolutionMinutes: number;
    recurringIssues: Array<{ propertyId: string; issues: number }>;
    topCategories: Array<{ category: string; count: number }>;
  };
  guest: {
    avgSatisfaction: number;
    sentimentBreakdown: Record<string, number>;
    complaints: number;
    returningGuests: number;
    languages: Array<{ language: string; count: number }>;
  };
  commercial: {
    upsellsSuggested: number;
    upsellsAccepted: number;
    opportunities: number;
  };
  cost: {
    totalUsd: number;
    tokensIn: number;
    tokensOut: number;
    costPerConversation: number;
    costPerResolution: number;
    byTenant: Array<{ tenantId: string; costUsd: number; interactions: number }>;
    byAgent: Array<{ agent: string; costUsd: number }>;
  };
  healthScore: number;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0) || 0);
const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const avg = (list: number[]): number => (list.length ? Math.round((list.reduce((s, n) => s + n, 0) / list.length) * 100) / 100 : 0);

export async function computeSaasAnalytics(supabase: SupabaseClient, period: Period): Promise<SaasAnalytics> {
  const since = periodStart(period);

  const [logsR, convR, msgR, propsR, escR, evalR, alertsR, feedbackR] = await Promise.all([
    supabase
      .from("ai_agent_logs")
      .select("owner_id, property_id, conversation_id, confidence, needs_human, latency_ms, tokens, cost_estimate, selected_agent, reflection, intent, channel_origin, escalation_triggered, created_at")
      .gte("created_at", since)
      .limit(20000),
    supabase.from("ai_conversations").select("id, tenant_id, property_id, guest_id, channel_origin, status, created_at").gte("created_at", since).limit(20000),
    supabase.from("ai_messages").select("id, tenant_id, sender_type, channel_origin, cost_usd, tokens_in, tokens_out").gte("created_at", since).limit(50000),
    supabase.from("properties").select("id, owner_id"),
    supabase.from("ai_human_escalations").select("id, owner_id, status, created_at, updated_at").gte("created_at", since).limit(10000),
    supabase.from("ai_agent_evaluations").select("agent_key, quality_score, created_at").gte("created_at", since).limit(5000),
    supabase.from("ai_proactive_actions").select("id, action_type, status, created_at").gte("created_at", since).limit(10000),
    supabase.from("chat_message_feedback").select("rating, created_at").gte("created_at", since).limit(10000),
  ]);

  const logs = (logsR.data ?? []) as Array<Record<string, any>>;
  const convs = (convR.data ?? []) as Array<Record<string, any>>;
  const msgs = (msgR.data ?? []) as Array<Record<string, any>>;
  const props = (propsR.data ?? []) as Array<Record<string, any>>;
  const escalations = (escR.data ?? []) as Array<Record<string, any>>;
  const evals = (evalR.data ?? []) as Array<Record<string, any>>;
  const proactive = (alertsR.data ?? []) as Array<Record<string, any>>;
  const feedback = (feedbackR.data ?? []) as Array<Record<string, any>>;

  // ── Utilização
  const tenants = new Set<string>();
  logs.forEach((l) => l.owner_id && tenants.add(String(l.owner_id)));
  convs.forEach((c) => c.tenant_id && tenants.add(String(c.tenant_id)));

  const byChannel: Record<string, number> = {};
  msgs.forEach((m) => { const k = String(m.channel_origin ?? "platform_chat"); byChannel[k] = (byChannel[k] ?? 0) + 1; });
  logs.forEach((l) => { if (!msgs.length) { const k = String(l.channel_origin ?? "platform_chat"); byChannel[k] = (byChannel[k] ?? 0) + 1; } });

  const usersByTenant = new Map<string, Set<string>>();
  convs.forEach((c) => {
    const t = String(c.tenant_id ?? "");
    if (!t) return;
    if (!usersByTenant.has(t)) usersByTenant.set(t, new Set());
    if (c.guest_id) usersByTenant.get(t)!.add(String(c.guest_id));
  });

  const guests = new Set<string>();
  convs.forEach((c) => c.guest_id && guests.add(String(c.guest_id)));

  // ── IA
  const interactions = logs.length;
  const escalated = logs.filter((l) => l.needs_human === true || l.escalation_triggered === true).length;
  const confidences = logs.map((l) => num(l.confidence)).filter((n) => n > 0);
  const reflections = logs
    .map((l) => num((l.reflection as Record<string, unknown> | null)?.["score"]))
    .filter((n) => n > 0);
  const latencies = logs.map((l) => num(l.latency_ms)).filter((n) => n > 0);

  const agentMap = new Map<string, { runs: number; escalations: number; conf: number[]; lat: number[]; cost: number }>();
  logs.forEach((l) => {
    const key = String(l.selected_agent ?? "generalist");
    if (!agentMap.has(key)) agentMap.set(key, { runs: 0, escalations: 0, conf: [], lat: [], cost: 0 });
    const a = agentMap.get(key)!;
    a.runs += 1;
    if (l.needs_human) a.escalations += 1;
    if (num(l.confidence) > 0) a.conf.push(num(l.confidence));
    if (num(l.latency_ms) > 0) a.lat.push(num(l.latency_ms));
    a.cost += num(l.cost_estimate);
  });

  // ── Custos
  let tokensIn = 0, tokensOut = 0, totalCost = 0;
  const costByTenant = new Map<string, { cost: number; runs: number }>();
  logs.forEach((l) => {
    const tk = (l.tokens ?? {}) as Record<string, unknown>;
    tokensIn += num(tk["input"]);
    tokensOut += num(tk["output"]);
    const c = num(l.cost_estimate);
    totalCost += c;
    const t = String(l.owner_id ?? "desconhecido");
    const acc = costByTenant.get(t) ?? { cost: 0, runs: 0 };
    acc.cost += c; acc.runs += 1;
    costByTenant.set(t, acc);
  });
  msgs.forEach((m) => { tokensIn += num(m.tokens_in); tokensOut += num(m.tokens_out); totalCost += num(m.cost_usd); });

  const resolvedCount = interactions - escalated;

  // ── Operação
  const resolvedEsc = escalations.filter((e) => String(e.status) === "resolved");
  const resolutionMinutes = resolvedEsc
    .map((e) => (new Date(e.updated_at).getTime() - new Date(e.created_at).getTime()) / 60000)
    .filter((n) => Number.isFinite(n) && n >= 0);

  const issuesByProperty = new Map<string, number>();
  logs.forEach((l) => {
    const intent = (l.intent ?? {}) as Record<string, unknown>;
    if (String(intent["category"] ?? "") === "operacional" && l.property_id) {
      const p = String(l.property_id);
      issuesByProperty.set(p, (issuesByProperty.get(p) ?? 0) + 1);
    }
  });

  const categoryCount = new Map<string, number>();
  logs.forEach((l) => {
    const intent = (l.intent ?? {}) as Record<string, unknown>;
    const c = String(intent["category"] ?? "outros");
    categoryCount.set(c, (categoryCount.get(c) ?? 0) + 1);
  });

  // ── Experiência do hóspede
  const sentiment: Record<string, number> = {};
  logs.forEach((l) => {
    const intent = (l.intent ?? {}) as Record<string, unknown>;
    const s = String(intent["sentiment"] ?? "neutro");
    sentiment[s] = (sentiment[s] ?? 0) + 1;
  });
  const complaints = logs.filter((l) => String(((l.intent ?? {}) as Record<string, unknown>)["category"] ?? "") === "reclamacao").length
    + (sentiment["negativo"] ?? 0);

  const languages = new Map<string, number>();
  logs.forEach((l) => {
    const intent = (l.intent ?? {}) as Record<string, unknown>;
    const lang = String(intent["language"] ?? intent["locale"] ?? "pt");
    languages.set(lang, (languages.get(lang) ?? 0) + 1);
  });

  const guestCounts = new Map<string, number>();
  convs.forEach((c) => { if (c.guest_id) guestCounts.set(String(c.guest_id), (guestCounts.get(String(c.guest_id)) ?? 0) + 1); });
  const returningGuests = [...guestCounts.values()].filter((n) => n > 1).length;

  const ratings = feedback.map((f) => num(f.rating)).filter((n) => n > 0);

  // ── Comercial
  const upsellsSuggested = logs.filter((l) => String(l.selected_agent ?? "") === "revenue").length;
  const upsellsAccepted = proactive.filter((p) => String(p.status) === "completed" && String(p.action_type ?? "").includes("upsell")).length;

  const resolutionRate = pct(resolvedCount, interactions);
  const escalationRate = pct(escalated, interactions);
  const avgConfidence = avg(confidences);
  const reflectionQuality = evals.length ? avg(evals.map((e) => num(e.quality_score))) : avg(reflections);

  const costPerConversation = convs.length ? Math.round((totalCost / convs.length) * 10000) / 10000 : 0;
  const costPerResolution = resolvedCount ? Math.round((totalCost / resolvedCount) * 10000) / 10000 : 0;

  // ── Health Score (0-100)
  const satisfactionNorm = ratings.length ? (avg(ratings) / 5) * 100 : 75;
  const costNorm = costPerResolution <= 0.02 ? 100 : Math.max(0, 100 - (costPerResolution - 0.02) * 1000);
  const healthScore = Math.round(
    resolutionRate * 0.35 +
    satisfactionNorm * 0.2 +
    avgConfidence * 100 * 0.2 +
    costNorm * 0.1 +
    Math.max(0, 100 - escalationRate) * 0.15,
  );

  return {
    period,
    since,
    usage: {
      activeTenants: tenants.size,
      connectedProperties: props.length,
      guestsServed: guests.size,
      conversations: convs.length,
      messages: msgs.length,
      byChannel,
      activeUsersByTenant: [...usersByTenant.entries()]
        .map(([tenantId, set]) => ({ tenantId, users: set.size }))
        .sort((a, b) => b.users - a.users)
        .slice(0, 20),
    },
    ai: {
      interactions,
      resolutionRate,
      escalationRate,
      avgConfidence,
      reflectionQuality,
      avgLatencyMs: Math.round(avg(latencies)),
      agentPerformance: [...agentMap.entries()]
        .map(([agent, a]) => ({
          agent,
          runs: a.runs,
          resolutionRate: pct(a.runs - a.escalations, a.runs),
          avgConfidence: avg(a.conf),
          avgLatencyMs: Math.round(avg(a.lat)),
        }))
        .sort((a, b) => b.runs - a.runs),
    },
    operations: {
      ticketsCreated: escalations.length,
      ticketsResolved: resolvedEsc.length,
      avgResolutionMinutes: Math.round(avg(resolutionMinutes)),
      recurringIssues: [...issuesByProperty.entries()]
        .map(([propertyId, issues]) => ({ propertyId, issues }))
        .filter((r) => r.issues > 1)
        .sort((a, b) => b.issues - a.issues)
        .slice(0, 10),
      topCategories: [...categoryCount.entries()]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    },
    guest: {
      avgSatisfaction: avg(ratings),
      sentimentBreakdown: sentiment,
      complaints,
      returningGuests,
      languages: [...languages.entries()].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    },
    commercial: {
      upsellsSuggested,
      upsellsAccepted,
      opportunities: proactive.length,
    },
    cost: {
      totalUsd: Math.round(totalCost * 10000) / 10000,
      tokensIn,
      tokensOut,
      costPerConversation,
      costPerResolution,
      byTenant: [...costByTenant.entries()]
        .map(([tenantId, v]) => ({ tenantId, costUsd: Math.round(v.cost * 10000) / 10000, interactions: v.runs }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 20),
      byAgent: [...agentMap.entries()]
        .map(([agent, a]) => ({ agent, costUsd: Math.round(a.cost * 10000) / 10000 }))
        .sort((a, b) => b.costUsd - a.costUsd),
    },
    healthScore: Math.max(0, Math.min(100, healthScore)),
  };
}
