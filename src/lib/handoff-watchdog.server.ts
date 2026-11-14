/**
 * VIGIA DE ENCAMINHAMENTOS SEM RESPOSTA (14/11/2026). O encaminhamento da IA é silencioso: o hóspede não recebe
 * aviso, e a equipe recebe UM push. Sem este vigia, um push perdido deixa o hóspede esperando indefinidamente.
 * Regra: conversa `needs_human` com `handoff_at` e SEM nenhuma mensagem de humano/IA depois dele ⇒
 *  - ≥ GUEST_AI_WATCHDOG_REMIND_MIN (padrão 10): novo push de urgência alta (1º lembrete);
 *  - ≥ GUEST_AI_WATCHDOG_ESCALATE_MIN (padrão 30): segundo aviso (escalonamento).
 * Cada etapa dispara UMA vez (colunas `handoff_reminded_at` / `handoff_escalated_at`). Nunca fala com o hóspede,
 * nunca muda o status da conversa, nunca lança. Desligável com GUEST_AI_WATCHDOG=off.
 */
export interface WatchdogRow {
  id: string;
  property_id: string;
  status: string | null;
  handoff_at: string | null;
  handoff_reason: string | null;
  guest_name: string | null;
  handoff_reminded_at: string | null;
  handoff_escalated_at: string | null;
}
export interface WatchdogConfig {
  remindMs: number;
  escalateMs: number;
  enabled: boolean;
}
export function watchdogConfig(env: Record<string, string | undefined> = process.env): WatchdogConfig {
  const min = (k: string, d: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= 1 && v <= 1440 ? v : d;
  };
  const remind = min("GUEST_AI_WATCHDOG_REMIND_MIN", 10);
  const esc = Math.max(min("GUEST_AI_WATCHDOG_ESCALATE_MIN", 30), remind + 1);
  return { remindMs: remind * 60_000, escalateMs: esc * 60_000, enabled: env["GUEST_AI_WATCHDOG"] !== "off" };
}

export type WatchdogAction = { id: string; stage: "remind" | "escalate" };

/** Decisão PURA: quais conversas pedem lembrete/escalonamento agora. `answered` = ids com resposta depois do handoff. */
export function planWatchdog(rows: readonly WatchdogRow[], answered: ReadonlySet<string>, nowMs: number, cfg: WatchdogConfig): WatchdogAction[] {
  if (!cfg.enabled) return [];
  const out: WatchdogAction[] = [];
  for (const r of rows) {
    if (r.status !== "needs_human" || !r.handoff_at || answered.has(r.id)) continue;
    const t = Date.parse(r.handoff_at);
    if (!Number.isFinite(t)) continue;
    const age = nowMs - t;
    if (age >= cfg.escalateMs && !r.handoff_escalated_at) out.push({ id: r.id, stage: "escalate" });
    else if (age >= cfg.remindMs && !r.handoff_reminded_at && !r.handoff_escalated_at) out.push({ id: r.id, stage: "remind" });
  }
  return out;
}

export interface WatchdogDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  now?: () => number;
  env?: Record<string, string | undefined>;
  push?: (db: unknown, p: { propertyId: string; conversationId: string; guestName: string | null; reason: string; urgency: string }) => Promise<void>;
}

export async function runHandoffWatchdog(deps: WatchdogDeps = {}): Promise<{ checked: number; reminded: number; escalated: number }> {
  const res = { checked: 0, reminded: 0, escalated: 0 };
  try {
    const cfg = watchdogConfig(deps.env);
    if (!cfg.enabled) return res;
    const db = deps.db ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const nowMs = (deps.now ?? Date.now)();
    const cutoff = new Date(nowMs - cfg.remindMs).toISOString();
    const since = new Date(nowMs - 24 * 3_600_000).toISOString(); // ignora encaminhamentos com mais de 24 h (já tratados à mão)
    const { data } = await db
      .from("property_chat_conversations")
      .select("id, property_id, status, handoff_at, handoff_reason, guest_name, handoff_reminded_at, handoff_escalated_at")
      .eq("status", "needs_human")
      .not("handoff_at", "is", null)
      .lte("handoff_at", cutoff)
      .gte("handoff_at", since)
      .limit(200);
    const rows = (data ?? []) as WatchdogRow[];
    res.checked = rows.length;
    if (!rows.length) return res;
    // quem já foi respondido (humano ou IA, nota interna não conta) depois do encaminhamento sai da fila
    const answered = new Set<string>();
    for (const r of rows) {
      const { data: msgs } = await db
        .from("property_chat_messages")
        .select("id")
        .eq("conversation_id", r.id)
        .eq("role", "assistant")
        .neq("sender_type", "internal_note")
        .gte("created_at", r.handoff_at as string)
        .limit(1);
      if (Array.isArray(msgs) && msgs.length > 0) answered.add(r.id);
    }
    const push =
      deps.push ??
      (async (d: unknown, p: { propertyId: string; conversationId: string; guestName: string | null; reason: string; urgency: string }) => {
        const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
        const userIds = await getPropertyNotifiableUsers(d as never, p.propertyId);
        await sendHandoffPush(d as never, { userIds, conversationId: p.conversationId, propertyName: "", guestName: p.guestName, guestMessage: "", checkinDate: null, reason: p.reason, urgency: p.urgency } as never);
      });
    for (const a of planWatchdog(rows, answered, nowMs, cfg)) {
      const row = rows.find((r) => r.id === a.id)!;
      try {
        const lead = a.stage === "remind" ? "Hóspede aguardando resposta há mais de 10 min" : "Hóspede SEM resposta há mais de 30 min — escalonamento";
        await push(db, { propertyId: row.property_id, conversationId: row.id, guestName: row.guest_name, reason: `${lead}. ${row.handoff_reason ?? ""}`.trim(), urgency: "high" });
        await db
          .from("property_chat_conversations")
          .update(a.stage === "remind" ? { handoff_reminded_at: new Date(nowMs).toISOString() } : { handoff_escalated_at: new Date(nowMs).toISOString() })
          .eq("id", row.id);
        if (a.stage === "remind") res.reminded++; else res.escalated++;
      } catch (e) {
        console.error("[handoff-watchdog] falha ao avisar", e instanceof Error ? e.name : "erro");
      }
    }
  } catch (e) {
    console.error("[handoff-watchdog] falhou", e instanceof Error ? e.name : "erro");
  }
  return res;
}
