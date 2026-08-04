/**
 * Event Intelligence Engine + execução das ações proativas.
 *
 * Varre reservas, memória operacional e memória de hóspede para produzir
 * sinais; cruza os sinais com o Proactive Rules Engine; grava as ações em
 * `ai_proactive_actions` respeitando o limite de autonomia.
 *
 * Nada é enviado ao hóspede aqui: ações de autonomia baixa ficam prontas para
 * execução, médias aguardam validação e altas sempre exigem humano.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalFor,
  PROACTIVE_RULES,
  type ProactiveAutonomy,
  type ProactiveSignal,
  type ProactiveTrigger,
} from "./rules";

const HOUR = 3_600_000;

export type ScanResult = {
  tenants: number;
  signals: number;
  created: number;
  skipped: number;
  byRule: Record<string, number>;
};

/** Gera sinais para um imóvel a partir do estado atual (reservas, histórico). */
export async function collectSignals(params: {
  supabase: SupabaseClient;
  tenantId: string;
  ownerId: string;
  propertyId: string;
  propertyName?: string | null;
}): Promise<ProactiveSignal[]> {
  const { supabase, tenantId, ownerId, propertyId } = params;
  const now = Date.now();
  const signals: ProactiveSignal[] = [];

  const horizon = new Date(now - 2 * 24 * HOUR).toISOString().slice(0, 10);
  const [{ data: reservations }, { data: ops }, { data: guests }] = await Promise.all([
    supabase
      .from("property_reservations")
      .select("id, checkin_date, checkout_date, guest_hint, status, created_at")
      .eq("property_id", propertyId)
      .gte("checkout_date", horizon)
      .limit(100),
    supabase
      .from("ai_operational_memory")
      .select("id, category, recurrence_count, satisfaction, status, guest_key, guest_name, conversation_id")
      .eq("owner_id", ownerId)
      .eq("property_id", propertyId)
      .gte("recurrence_count", 2)
      .limit(50),
    supabase
      .from("ai_guest_memory")
      .select("guest_key, guest_name, preferences, updated_at")
      .eq("owner_id", ownerId)
      .eq("property_id", propertyId)
      .limit(200),
  ]);

  const base = { tenantId, ownerId, propertyId, propertyName: params.propertyName ?? null };
  const stayCount = new Map<string, number>();
  for (const g of guests ?? []) {
    const prefs = (g.preferences ?? {}) as Record<string, unknown>;
    stayCount.set(String(g.guest_name ?? g.guest_key ?? "").toLowerCase(), Number(prefs.stays ?? 1));
  }

  for (const r of reservations ?? []) {
    if (r.status && r.status !== "confirmed" && r.status !== "active") continue;
    const checkin = new Date(`${r.checkin_date}T12:00:00Z`).getTime();
    const checkout = new Date(`${r.checkout_date}T12:00:00Z`).getTime();
    const guestName = r.guest_hint ?? null;
    const common = { ...base, reservationId: r.id, guestId: guestName, guestName };

    if (now - new Date(r.created_at).getTime() < 24 * HOUR) {
      signals.push({ ...common, trigger: "reservation_created", payload: { checkin: r.checkin_date, checkout: r.checkout_date } });
    }
    if (checkin > now) {
      signals.push({
        ...common,
        trigger: "checkin_upcoming",
        payload: { hoursToCheckin: Math.round((checkin - now) / HOUR), checkin: r.checkin_date },
      });
    }
    if (checkout > now && checkin <= now) {
      signals.push({
        ...common,
        trigger: "checkout_upcoming",
        payload: { hoursToCheckout: Math.round((checkout - now) / HOUR), checkout: r.checkout_date },
      });
    }
    const previousStays = stayCount.get(String(guestName ?? "").toLowerCase()) ?? 0;
    if (previousStays >= 1 && checkin > now) {
      signals.push({ ...common, trigger: "returning_guest", payload: { previousStays } });
    }
  }

  for (const o of ops ?? []) {
    signals.push({
      ...base,
      conversationId: o.conversation_id ?? null,
      guestId: o.guest_key ?? null,
      guestName: o.guest_name ?? null,
      trigger: "recurring_issue",
      payload: { category: o.category, recurrenceCount: o.recurrence_count, status: o.status },
    });
    if (o.satisfaction === "negativo" || o.satisfaction === "insatisfeito") {
      signals.push({
        ...base,
        conversationId: o.conversation_id ?? null,
        guestId: o.guest_key ?? null,
        guestName: o.guest_name ?? null,
        trigger: "low_satisfaction",
        payload: { sentiment: "negativo", category: o.category },
      });
    }
  }

  return signals;
}

/** Aplica as regras a um sinal e registra as ações resultantes. */
export async function evaluateSignal(params: {
  supabase: SupabaseClient;
  signal: ProactiveSignal;
}): Promise<number> {
  const { supabase, signal } = params;
  let created = 0;

  for (const rule of PROACTIVE_RULES) {
    if (rule.trigger !== signal.trigger) continue;
    if (!rule.matches(signal)) continue;

    const { status, approval } = approvalFor(rule.autonomy);
    const dedupe = dedupeKey(signal, rule.key);

    const { error } = await supabase.from("ai_proactive_actions").insert({
      tenant_id: signal.tenantId,
      owner_id: signal.ownerId,
      property_id: signal.propertyId,
      reservation_id: signal.reservationId ?? null,
      conversation_id: signal.conversationId ?? null,
      guest_id: signal.guestId ?? null,
      guest_name: signal.guestName ?? null,
      trigger_event: signal.trigger,
      trigger_payload: signal.payload as never,
      rule_key: rule.key,
      recommended_action: rule.action(signal),
      action_payload: { description: rule.description } as never,
      autonomy_level: rule.autonomy,
      status,
      approval_status: approval,
      dedupe_key: dedupe,
    });
    if (!error) created += 1;
  }
  return created;
}

/** Varredura completa (cron). Percorre imóveis publicados de todos os tenants. */
export async function scanProactiveOpportunities(params: {
  supabase: SupabaseClient;
  tenantId?: string;
  propertyLimit?: number;
}): Promise<ScanResult> {
  const { supabase } = params;
  let query = supabase
    .from("properties")
    .select("id, owner_id, title")
    .eq("published", true)
    .limit(params.propertyLimit ?? 50);
  if (params.tenantId) query = query.eq("owner_id", params.tenantId);

  const { data: properties } = await query;
  const result: ScanResult = { tenants: 0, signals: 0, created: 0, skipped: 0, byRule: {} };
  const tenants = new Set<string>();

  for (const property of properties ?? []) {
    if (!property.owner_id) continue;
    tenants.add(property.owner_id);
    const signals = await collectSignals({
      supabase,
      tenantId: property.owner_id,
      ownerId: property.owner_id,
      propertyId: property.id,
      propertyName: property.title,
    });
    result.signals += signals.length;
    for (const signal of signals) {
      const created = await evaluateSignal({ supabase, signal });
      result.created += created;
      if (!created) result.skipped += 1;
      result.byRule[signal.trigger] = (result.byRule[signal.trigger] ?? 0) + created;
    }
  }

  result.tenants = tenants.size;
  return result;
}

/** Marca uma ação como executada (só o que já está aprovado pode executar). */
export async function markActionExecuted(params: {
  supabase: SupabaseClient;
  tenantId: string;
  actionId: string;
  executedAction: string;
  error?: string | null;
}): Promise<boolean> {
  const { data } = await params.supabase
    .from("ai_proactive_actions")
    .select("id, autonomy_level, status, approval_status")
    .eq("id", params.actionId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();
  if (!data) return false;

  const autonomy = (data.autonomy_level as ProactiveAutonomy) ?? "high";
  const humanApproved = data.approval_status === "approved";
  if (autonomy !== "low" && !humanApproved) return false;

  await params.supabase
    .from("ai_proactive_actions")
    .update({
      executed_action: params.executedAction,
      status: params.error ? "failed" : "executed",
      executed_at: new Date().toISOString(),
      error: params.error ?? null,
    })
    .eq("id", params.actionId)
    .eq("tenant_id", params.tenantId);
  return !params.error;
}

function dedupeKey(signal: ProactiveSignal, ruleKey: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return [signal.tenantId, signal.propertyId, signal.reservationId ?? signal.guestId ?? "-", ruleKey, day].join("|");
}

export type { ProactiveTrigger };
