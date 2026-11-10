/**
 * DECISÃO HUMANA COM 1 CLIQUE (10/11/2026, mockup e SQL aprovados pelo titular) — parte PURA, compartilhada
 * entre servidor e tela. Nada aqui lê banco ou chama modelo.
 *
 * Fluxo: o hóspede pede uma exceção (late check-out, entrada antecipada, concessão operacional) → a IA NÃO
 * responde (sem frase de espera) → abre UMA decisão pendente (`guest_ai_human_decisions`) com pergunta curta e
 * 2–4 botões → a equipe clica → a ação oficial roda e a IA manda UMA resposta ao hóspede (salvo "Eu assumo").
 * Enquanto houver decisão pendente na conversa, a IA fica em silêncio absoluto (slot).
 */

export const DECISION_KINDS = ["late_checkout", "early_checkin", "operational_concession", "general_decision"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export type DecisionVariant = "primary" | "secondary" | "neutral" | "assume";
export type DecisionIntent = "approve" | "charge" | "decline" | "assume";

export interface DecisionOption {
  id: string;
  label: string;
  variant: DecisionVariant;
  ai_intent: DecisionIntent;
  /** Horário concedido (HH:MM), só na aprovação de late check-out / entrada antecipada com horário pedido. */
  time?: string;
}

export type DecisionStatus = "pending" | "decided" | "expired";
export type DecisionReplyStatus = "pending" | "sent" | "silent" | "error";

/** Linha como a tela a lê (projeção explícita). */
export interface HumanDecisionRow {
  id: string;
  property_id: string;
  conversation_id: string;
  trigger_message_id: string;
  kind: DecisionKind;
  question_text: string;
  options: DecisionOption[];
  status: DecisionStatus;
  decided_option_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  ai_reply_status: DecisionReplyStatus;
  ai_reply_message_id: string | null;
  created_at: string;
}

export const DECISION_COLUMNS =
  "id, property_id, conversation_id, trigger_message_id, kind, question_text, options, status, decided_option_id, decided_by, decided_at, ai_reply_status, ai_reply_message_id, created_at";

/** Nome curto do tipo, no cabeçalho do cartão. */
export const DECISION_KIND_LABEL: Record<DecisionKind, string> = {
  late_checkout: "Late check-out",
  early_checkin: "Entrada antecipada",
  operational_concession: "Concessão",
  general_decision: "Decisão",
};

/** Prefixo do motivo do chamado (a bolha mostra "Decisão pendente" em vez de "Precisa de atendimento"). */
export const DECISION_HANDOFF_PREFIX = "Decisão pendente";
export const isDecisionHandoffReason = (reason: string | null | undefined): boolean =>
  (reason ?? "").startsWith(DECISION_HANDOFF_PREFIX);

/**
 * Pedido formal declarado pelo modelo ⇒ tipo de decisão. Só exceções que a EQUIPE concede no dia a dia; datas,
 * hóspedes, preço e cancelamento dependem da plataforma e seguem o encaminhamento normal.
 */
export function decisionKindFromRequests(requests: readonly string[] | null | undefined): DecisionKind | null {
  const r = new Set(requests ?? []);
  if (r.has("late_checkout")) return "late_checkout";
  if (r.has("early_checkin")) return "early_checkin";
  if (r.has("other_conditions")) return "operational_concession";
  return null;
}

/** "13h", "13h30", "13:00", "às 1pm", "1:30 pm" ⇒ "HH:MM"; nada reconhecível ⇒ null. */
export function extractRequestedTime(text: string | null | undefined): string | null {
  const t = (text ?? "").toLowerCase();
  const ampm = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b/.exec(t);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:${ampm[2] ?? "00"}`;
  }
  const m = /\b([01]?\d|2[0-3])\s*(?:h|:|hs\b|horas?\b)\s*([0-5]\d)?/.exec(t);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** "13:00" ⇒ "13h"; "13:30" ⇒ "13h30". */
export function formatHour(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? "");
  if (!m) return hhmm ?? "";
  return m[2] === "00" ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`;
}

/** Botões do cartão por tipo (2–4; rótulos curtos que cabem numa linha a 360px). */
export function buildDecisionOptions(kind: DecisionKind, time: string | null): DecisionOption[] {
  const assume: DecisionOption = { id: "assume", label: "Eu assumo a conversa", variant: "assume", ai_intent: "assume" };
  const decline: DecisionOption = { id: "decline", label: "Recusar com gentileza", variant: "neutral", ai_intent: "decline" };
  if (kind === "late_checkout" || kind === "early_checkin") {
    const approve: DecisionOption = time
      ? { id: "approve", label: `Aprovar ${formatHour(time)} (cortesia)`, variant: "primary", ai_intent: "approve", time }
      : { id: "approve", label: "Aprovar (cortesia)", variant: "primary", ai_intent: "approve" };
    return [approve, { id: "charge", label: "Cobrar meia diária", variant: "secondary", ai_intent: "charge" }, decline, assume];
  }
  return [{ id: "approve", label: "Aprovar", variant: "primary", ai_intent: "approve" }, decline, assume];
}

const words = (s: string) => s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
/** Corta em N palavras (com reticências quando cortou). */
export function clipWords(s: string, n: number): string {
  const w = words(s);
  return w.length <= n ? w.join(" ") : `${w.slice(0, n).join(" ")}…`;
}

export interface QuestionInput {
  kind: DecisionKind;
  guestName: string | null;
  time: string | null;
  officialCheckout: string | null;
  officialCheckin: string | null;
  /** `true`/`false` quando se sabe se há entrada no mesmo dia da saída; `null` = desconhecido. */
  sameDayArrival: boolean | null;
  /** Pergunta interna do modelo (quando houver) e a mensagem do hóspede, só para concessões. */
  internalQuestion: string | null;
  guestMessage: string | null;
}

/** Pergunta curta (~35 palavras, nunca mais de 45) para a equipe decidir. */
export function buildDecisionQuestion(q: QuestionInput): string {
  const who = (q.guestName ?? "").trim().split(/\s+/)[0] || "O hóspede";
  let s: string;
  if (q.kind === "late_checkout") {
    const official = q.officialCheckout ? ` (oficial ${formatHour(q.officialCheckout)})` : "";
    const when = q.time ? `saída às ${formatHour(q.time)}${official}` : `sair mais tarde${official}, sem horário definido`;
    const day =
      q.sameDayArrival === false ? " Não há entrada no mesmo dia." : q.sameDayArrival === true ? " Há entrada no mesmo dia." : "";
    s = `${who} pede ${when}.${day} Aprovar como cortesia?`;
  } else if (q.kind === "early_checkin") {
    const official = q.officialCheckin ? ` (oficial ${formatHour(q.officialCheckin)})` : "";
    const when = q.time ? `entrada às ${formatHour(q.time)}${official}` : `entrar mais cedo${official}, sem horário definido`;
    s = `${who} pede ${when}. Aprovar como cortesia?`;
  } else {
    const base = (q.internalQuestion ?? "").trim();
    s = base
      ? base
      : `${who} pede uma exceção: "${clipWords(q.guestMessage ?? "", 22)}". Como responder?`;
  }
  return clipWords(s, 45);
}

/** Resumo do motivo do chamado (bolha e lista). */
export function decisionHandoffReason(kind: DecisionKind, time: string | null): string {
  const t = time ? ` às ${formatHour(time)}` : "";
  const what =
    kind === "late_checkout" ? `late check-out${t}` : kind === "early_checkin" ? `entrada antecipada${t}` : "pedido de exceção";
  return `${DECISION_HANDOFF_PREFIX} · ${what}`;
}

/** Carimbo do estado decidido ("Late check-out aprovado · 13h", "Arthur assumiu a conversa"…). */
export function decidedHeadline(row: Pick<HumanDecisionRow, "kind" | "options" | "decided_option_id">, who: string): string {
  const opt = row.options.find((o) => o.id === row.decided_option_id);
  if (!opt) return "Decisão registrada";
  const subject = DECISION_KIND_LABEL[row.kind];
  if (opt.ai_intent === "assume") return `${who} assumiu a conversa`;
  if (opt.ai_intent === "approve") return `${subject} aprovado${opt.time ? ` · ${formatHour(opt.time)}` : ""}`;
  if (opt.ai_intent === "charge") return `${subject} com cobrança de meia diária`;
  return `${subject} recusado com gentileza`;
}
