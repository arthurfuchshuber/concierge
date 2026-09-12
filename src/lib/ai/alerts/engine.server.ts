/**
 * Intelligent Alerts Engine.
 *
 * Compara a janela recente com a janela anterior e materializa alertas em
 * `ai_alerts`. Roda no cron — nunca no caminho de resposta ao hóspede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type AlertDraft = {
  tenantId: string | null;
  propertyId?: string | null;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  metricValue?: number | null;
  baselineValue?: number | null;
};

const DAY = 86_400_000;

export async function generateAlerts(supabase: SupabaseClient): Promise<{ created: number }> {
  const now = Date.now();
  const currentSince = new Date(now - 7 * DAY).toISOString();
  const previousSince = new Date(now - 14 * DAY).toISOString();

  const [logsR, channelsR] = await Promise.all([
    supabase
      .from("ai_agent_logs")
      .select("owner_id, property_id, needs_human, confidence, intent, created_at")
      .gte("created_at", previousSince)
      .limit(20000),
    supabase.from("ai_channel_connections").select("tenant_id, channel_type, status, last_seen_at"),
  ]);

  const logs = (logsR.data ?? []) as Array<Record<string, any>>;
  const channels = (channelsR.data ?? []) as Array<Record<string, any>>;
  const drafts: AlertDraft[] = [];

  // Por tenant: escalonamento e confiança
  const tenants = new Set(logs.map((l) => String(l.owner_id ?? "")).filter(Boolean));
  for (const tenantId of tenants) {
    const mine = logs.filter((l) => String(l.owner_id) === tenantId);
    const cur = mine.filter((l) => l.created_at >= currentSince);
    const prev = mine.filter((l) => l.created_at < currentSince);
    if (cur.length < 10 || prev.length < 10) continue;

    const rate = (rows: typeof cur) => rows.filter((r) => r.needs_human).length / rows.length;
    const curRate = rate(cur), prevRate = rate(prev);
    if (prevRate > 0 && curRate >= prevRate * 1.4 && curRate - prevRate >= 0.05) {
      drafts.push({
        tenantId,
        kind: "escalation_spike",
        severity: "warning",
        title: "Aumento de escalonamentos humanos",
        detail: `Escalonamentos subiram de ${(prevRate * 100).toFixed(1)}% para ${(curRate * 100).toFixed(1)}% nos últimos 7 dias.`,
        metricValue: Math.round(curRate * 1000) / 10,
        baselineValue: Math.round(prevRate * 1000) / 10,
      });
    }

    const mean = (rows: typeof cur) => {
      const v = rows.map((r) => Number(r.confidence ?? 0)).filter((n) => n > 0);
      return v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0;
    };
    const curConf = mean(cur), prevConf = mean(prev);
    if (prevConf > 0 && curConf > 0 && curConf <= prevConf - 0.08) {
      drafts.push({
        tenantId,
        kind: "confidence_drop",
        severity: "warning",
        title: "Queda de confiança do modelo de IA",
        detail: `Confiança média caiu de ${prevConf.toFixed(2)} para ${curConf.toFixed(2)}.`,
        metricValue: Math.round(curConf * 100) / 100,
        baselineValue: Math.round(prevConf * 100) / 100,
      });
    }

    // Recorrência anormal de manutenção por imóvel
    const byProperty = new Map<string, number>();
    cur.forEach((l) => {
      const cat = String(((l.intent ?? {}) as Record<string, unknown>)["category"] ?? "");
      if (cat === "operacional" && l.property_id) {
        const p = String(l.property_id);
        byProperty.set(p, (byProperty.get(p) ?? 0) + 1);
      }
    });
    for (const [propertyId, count] of byProperty) {
      if (count >= 5) {
        drafts.push({
          tenantId,
          propertyId,
          kind: "maintenance_recurrence",
          severity: count >= 10 ? "critical" : "warning",
          title: "Recorrência anormal de manutenção",
          detail: `${count} solicitações operacionais neste imóvel em 7 dias.`,
          metricValue: count,
        });
      }
    }
  }

  // Canais desconectados / silenciosos
  for (const ch of channels) {
    const lastSeen = ch.last_seen_at ? new Date(ch.last_seen_at).getTime() : 0;
    const stale = lastSeen > 0 && now - lastSeen > 3 * DAY;
    if (String(ch.status) === "error" || String(ch.status) === "disconnected" || stale) {
      drafts.push({
        tenantId: String(ch.tenant_id),
        kind: "channel_disconnected",
        severity: "critical",
        title: `${String(ch.channel_type).toUpperCase()} desconectado`,
        detail: stale ? "Sem tráfego há mais de 3 dias." : "Conexão em estado de erro.",
      });
    }
  }

  let created = 0;
  for (const d of drafts) {
    // Deduplicação: não recriar alerta aberto do mesmo tipo nas últimas 24h.
    const { data: existing } = await supabase
      .from("ai_alerts")
      .select("id")
      .eq("kind", d.kind)
      .eq("status", "open")
      .gte("created_at", new Date(now - DAY).toISOString())
      .eq("tenant_id", d.tenantId ?? "")
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const { error } = await supabase.from("ai_alerts").insert({
      tenant_id: d.tenantId,
      property_id: d.propertyId ?? null,
      kind: d.kind,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      metric_value: d.metricValue ?? null,
      baseline_value: d.baselineValue ?? null,
    });
    if (!error) created += 1;
  }

  return { created };
}
