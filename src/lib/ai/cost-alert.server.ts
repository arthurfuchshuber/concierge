import type { SupabaseClient } from "@supabase/supabase-js";
import { dayKeyBR, detectCostSpike } from "./cost-alert";

type Admin = SupabaseClient;

/**
 * Varre o livro-caixa e avisa (push) o DONO da conta quando o gasto de hoje passa muito do normal.
 * Desligável com AI_COST_ALERT_DISABLED=1; limiares em AI_COST_ALERT_FACTOR (padrão 2) e
 * AI_COST_ALERT_MIN_USD (padrão 1). Um aviso por conta por dia. Nunca bloqueia uso.
 */
export async function runAiCostAlertScan(admin: Admin, now = new Date()) {
  if (process.env["AI_COST_ALERT_DISABLED"] === "1") return { disabled: true, owners: 0, alerted: 0 };
  const factor = Number(process.env["AI_COST_ALERT_FACTOR"] ?? 2) || 2;
  const minUsd = Number(process.env["AI_COST_ALERT_MIN_USD"] ?? 1) || 1;

  const since = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const { data, error } = await (admin as unknown as { from: (t: string) => any })
    .from("ai_usage_events")
    .select("created_at, owner_id, cost_usd")
    .gte("created_at", since)
    .not("owner_id", "is", null)
    .limit(200000);
  if (error) throw new Error(error.message);

  const today = dayKeyBR(now);
  const perOwner = new Map<string, Map<string, number>>();
  for (const r of (data ?? []) as Array<{ created_at: string; owner_id: string; cost_usd: number | string | null }>) {
    const m = perOwner.get(r.owner_id) ?? new Map<string, number>();
    const k = dayKeyBR(r.created_at);
    m.set(k, (m.get(k) ?? 0) + (Number(r.cost_usd ?? 0) || 0));
    perOwner.set(r.owner_id, m);
  }

  const { sendOpsPush } = await import("@/lib/ops-push.server");
  let alerted = 0;
  for (const [ownerId, days] of perOwner) {
    const todayUsd = days.get(today) ?? 0;
    const previous = [...days.entries()].filter(([k]) => k !== today).map(([, v]) => v);
    const res = detectCostSpike(todayUsd, previous, { factor, minUsd });
    if (!res.spike) continue;
    const r = await sendOpsPush(admin, {
      ownerId,
      kind: "ai_cost_spike",
      dedupeKey: `ai-cost-spike:${ownerId}:${today}`,
      userIds: [ownerId],
      payload: {
        title: "Gasto de IA acima do normal hoje",
        body: `US$ ${res.todayUsd.toFixed(2)} hoje, cerca de ${res.ratio.toFixed(1)}x a média dos últimos dias (US$ ${res.baselineUsd.toFixed(2)}). É só um aviso; nada foi bloqueado.`,
        data: { url: "/", tag: "ai-cost-spike" },
      },
    });
    if (r.sent > 0) alerted += 1;
  }
  return { disabled: false, owners: perOwner.size, alerted };
}
