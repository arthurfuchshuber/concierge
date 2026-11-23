/**
 * VIGIA DE ENCAMINHAMENTOS SEM RESPOSTA (14/11/2026). O encaminhamento da IA é silencioso: o hóspede não recebe
 * aviso, e a equipe recebe UM push. Sem este vigia, um push perdido deixa o hóspede esperando indefinidamente.
 * Regra: conversa `needs_human` com `handoff_at` cuja ÚLTIMA fala (fora nota interna) é do hóspede ⇒
 *  - ≥ GUEST_AI_WATCHDOG_REMIND_MIN (padrão 10): novo push de urgência alta (1º lembrete);
 *  - ≥ GUEST_AI_WATCHDOG_ESCALATE_MIN (padrão 30): segundo aviso (escalonamento).
 * Cada etapa dispara UMA vez (colunas `handoff_reminded_at` / `handoff_escalated_at`). Nunca fala com o hóspede,
 * (23/11/2026, caso Roberto/Studio 101) Também cobre conversa já ASSUMIDA (`assigned`) cuja última fala é do hóspede
 * e cujo turno da IA para essa mensagem falhou, foi recusado ou pediu a equipe: ali ninguém era avisado de novo. O
 * tempo conta da mensagem do hóspede, e cada nova mensagem sem resposta reabre um lembrete e um escalonamento.
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


/** Conversa assumida esperando a equipe: tempo conta da última mensagem do hóspede. */
export interface AssignedWaitRow {
  id: string;
  property_id: string;
  guest_name: string | null;
  handoff_reason: string | null;
  handoff_reminded_at: string | null;
  handoff_escalated_at: string | null;
  /** última mensagem (fora nota interna) é do hóspede, e quando chegou */
  lastGuestAt: string;
}
export function planAssignedWatchdog(rows: readonly AssignedWaitRow[], nowMs: number, cfg: WatchdogConfig): WatchdogAction[] {
  if (!cfg.enabled) return [];
  const out: WatchdogAction[] = [];
  const before = (flag: string | null, t: number) => !flag || !(Date.parse(flag) >= t);
  for (const r of rows) {
    const t = Date.parse(r.lastGuestAt);
    if (!Number.isFinite(t)) continue;
    const age = nowMs - t;
    if (age >= cfg.escalateMs && before(r.handoff_escalated_at, t)) out.push({ id: r.id, stage: "escalate" });
    else if (age >= cfg.remindMs && before(r.handoff_reminded_at, t) && before(r.handoff_escalated_at, t)) out.push({ id: r.id, stage: "remind" });
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
    const push =
      deps.push ??
      (async (d: unknown, p: { propertyId: string; conversationId: string; guestName: string | null; reason: string; urgency: string }) => {
        const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
        const userIds = await getPropertyNotifiableUsers(d as never, p.propertyId);
        await sendHandoffPush(d as never, { userIds, conversationId: p.conversationId, propertyName: "", guestName: p.guestName, guestMessage: "", checkinDate: null, reason: p.reason, urgency: p.urgency } as never);
      });
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
    if (!rows.length) {
      await runAssignedPass(db, nowMs, cfg, since, push, res);
      return res;
    }
    // quem já foi respondido (humano ou IA, nota interna não conta) depois do encaminhamento sai da fila.
    // Caso Nailton (18/11/2026): o filtro antigo `sender_type <> 'internal_note'` não é valor do enum, a consulta
    // falhava em silêncio e TODO encaminhamento virava "aguardando resposta", mesmo com a IA já tendo respondido.
    // Nota interna é `is_internal_note`. Leitura falhou ⇒ não avisa (não afirma ao time o que não conferiu).
    const answered = new Set<string>();
    const unknown = new Set<string>();
    for (const r of rows) {
      // hóspede só está "aguardando" se a ÚLTIMA fala (fora nota interna) é dele; a resposta da IA pode ser gravada
      // segundos antes ou depois do encaminhamento, então não se compara com `handoff_at`
      const { data: msgs, error } = await db
        .from("property_chat_messages")
        .select("id, role")
        .eq("conversation_id", r.id)
        .eq("is_internal_note", false)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !Array.isArray(msgs)) unknown.add(r.id);
      else if (msgs.length > 0 && (msgs[0] as { role?: string }).role !== "user") answered.add(r.id);
    }
    if (unknown.size > 0) console.error("[handoff-watchdog] leitura de respostas falhou", unknown.size);
    for (const a of planWatchdog(rows.filter((r) => !unknown.has(r.id)), answered, nowMs, cfg)) {
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
    await runAssignedPass(db, nowMs, cfg, since, push, res);
  } catch (e) {
    console.error("[handoff-watchdog] falhou", e instanceof Error ? e.name : "erro");
  }
  return res;
}

/** Turnos da IA que deixam o hóspede sem resposta: falha técnica, recusa ou pedido explícito da equipe. */
const UNANSWERED_TURN = (t: { outcome_kind?: string | null; handoff_needed?: boolean | null }) =>
  t.outcome_kind === "technical_error" || t.outcome_kind === "refused" || t.handoff_needed === true;

async function runAssignedPass(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  nowMs: number,
  cfg: WatchdogConfig,
  since: string,
  push: (db: unknown, p: { propertyId: string; conversationId: string; guestName: string | null; reason: string; urgency: string }) => Promise<void>,
  res: { checked: number; reminded: number; escalated: number },
): Promise<void> {
  const { data } = await db
    .from("property_chat_conversations")
    .select("id, property_id, guest_name, handoff_reason, handoff_reminded_at, handoff_escalated_at, last_message_at")
    .eq("status", "assigned")
    .gte("last_message_at", since)
    .lte("last_message_at", new Date(nowMs - cfg.remindMs).toISOString())
    .limit(200);
  const convs = (data ?? []) as Array<Omit<AssignedWaitRow, "lastGuestAt">>;
  const waiting: AssignedWaitRow[] = [];
  for (const c of convs) {
    const { data: msgs, error } = await db
      .from("property_chat_messages")
      .select("id, role, created_at")
      .eq("conversation_id", c.id)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = !error && Array.isArray(msgs) ? (msgs[0] as { id: string; role?: string; created_at: string } | undefined) : undefined;
    if (!last || last.role !== "user") continue;
    const { data: turns, error: te } = await db
      .from("guest_ai_turns")
      .select("outcome_kind, handoff_needed")
      .eq("trigger_message_id", last.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const turn = !te && Array.isArray(turns) ? (turns[0] as { outcome_kind?: string | null; handoff_needed?: boolean | null } | undefined) : undefined;
    // sem turno (pausa humana) ou turno que silenciou de propósito (agradecimento) ⇒ não incomoda a equipe
    if (!turn || !UNANSWERED_TURN(turn)) continue;
    waiting.push({ ...c, lastGuestAt: last.created_at });
  }
  res.checked += waiting.length;
  for (const a of planAssignedWatchdog(waiting, nowMs, cfg)) {
    const row = waiting.find((r) => r.id === a.id)!;
    try {
      const lead = a.stage === "remind" ? "Hóspede aguardando resposta há mais de 10 min (conversa assumida)" : "Hóspede SEM resposta há mais de 30 min (conversa assumida) — escalonamento";
      await push(db, { propertyId: row.property_id, conversationId: row.id, guestName: row.guest_name, reason: `${lead}. ${row.handoff_reason ?? ""}`.trim(), urgency: "high" });
      await db
        .from("property_chat_conversations")
        .update(a.stage === "remind" ? { handoff_reminded_at: new Date(nowMs).toISOString() } : { handoff_escalated_at: new Date(nowMs).toISOString() })
        .eq("id", row.id);
      if (a.stage === "remind") res.reminded++; else res.escalated++;
    } catch (e) {
      console.error("[handoff-watchdog] falha ao avisar (assumida)", e instanceof Error ? e.name : "erro");
    }
  }
}
