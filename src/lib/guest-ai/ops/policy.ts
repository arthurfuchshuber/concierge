/**
 * GATE G2 · POLÍTICA DETERMINÍSTICA das ações operacionais (pura: sem banco, rede nem relógio; o
 * instante chega por parâmetro). Diretrizes oficiais do titular (06/11/2026), itens 1 a 6:
 *
 *  - conclusão de check-in: o hóspede confirma que ENTROU; só com a estadia em curso (fase `in_stay`,
 *    ou seja, depois do horário oficial de entrada no fuso do imóvel — item 5: nunca antes do dia ou do
 *    horário oficial sem autorização; entrada antecipada não tem fonte de autorização);
 *  - conclusão de check-out: o hóspede confirma que SAIU, no dia da saída (no fuso do imóvel); SAÍDA
 *    ANTECIPADA (item 3): antes da data final, com a estadia em curso, só com fato consumado explícito
 *    ("já saí", "deixei as chaves") ⇒ `early_departure`, card de saída puxado para HOJE;
 *  - previsão de horário: só para a data do próprio card, dentro dos limites oficiais do imóvel (D-G2-5),
 *    nunca sobre previsão da equipe; MADRUGADA (item 1): chegada entre 00:00 e 05:00 pertence à noite da
 *    data de entrada (nunca "amanhã"); janela que atravessa a meia-noite (ex.: 15:00–02:00) é respeitada;
 *  - item 6: chamado aberto, atendente atribuído, equipe no comando, problema ou negociação ⇒ nada;
 *  - LATE CHECKOUT (G2c, item 3 da diretriz definitiva): concessão expressa de um atendente HUMANO no chat
 *    (`ops/late-checkout.ts`) ⇒ registro no card de saída com autoria do atendente; pedido do hóspede nunca
 *    é autorização. As travas do item 6 não se aplicam: a decisão é da própria equipe.
 *
 * Cada sinal do modelo vira UMA avaliação (`would_apply` ou `refused` com motivo fechado). Sem sinal,
 * nenhuma avaliação. Qualquer verificação que falhe ⇒ recusa. A política não escreve nada.
 */
import type { GuestEta, ModelDecision } from "../orchestrator/contracts";
import type { StayPhase } from "../types";
import { parseHm } from "../policy/wall-clock";
import type {
  OpsAction,
  OpsCardState,
  OpsConversationState,
  OpsEvaluation,
  OpsPropertyTimes,
  OpsRefusalCode,
  OpsReservationState,
} from "./contracts";
import { MADRUGADA_END_MINUTES } from "./contracts";
import {
  lexicalGuard,
  pastDepartureMarker,
  sentenceContaining,
  timeAppearsInQuote,
  type LexicalKind,
} from "./lexical";
import { addDaysIso } from "../policy/wall-clock";
import { detectStaffLateCheckout } from "./late-checkout";
import { detectStaffEarlyCheckin } from "./early-checkin";

/** Entrada do histórico do turno (mesma origem do prompt; `ref` = id citável, `messageId` = id real). */
export interface OpsHistoryEntry {
  ref: string;
  messageId: string;
  speaker: string;
  text: string;
  /** Instante ISO da mensagem (usado pela janela do late checkout concedido pela equipe). */
  at?: string;
}

export interface OpsPolicyInput {
  decision: ModelDecision;
  history: readonly OpsHistoryEntry[];
  /** Fase calculada pelo servidor para o turno. */
  phase: StayPhase;
  /** Fuso IANA comprovado do imóvel (`null` ⇒ nada acontece). */
  timezone: string | null;
  now: Date;
  /** Reserva vinculada à conversa pelo código (`null` ⇒ nada acontece). */
  reservation: OpsReservationState | null;
  conversation: OpsConversationState | null;
  cards: { checkin: OpsCardState | null; checkout: OpsCardState | null } | null;
  property: OpsPropertyTimes | null;
  /** Motivo padrão do encaminhamento "sem IA instalada" (não é chamado da equipe). */
  defaultHandoffReason: string;
}


/** Data local (YYYY-MM-DD) de um instante no fuso dado; `null` se o fuso for inválido. */
export function localDate(instant: Date, timezone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null;
  }
}

const minutes = (hm: string | null): number | null => {
  const p = parseHm(hm);
  return p ? p[0] * 60 + p[1] : null;
};

/**
 * Mesma regra do formulário do guia (`withinTimeBounds`): sem limite configurado, aquele lado é livre.
 * Janela que atravessa a meia-noite (máximo menor que o mínimo, ex.: 15:00–02:00) vale dos dois lados.
 */
export function withinBounds(time: string, min: string | null, max: string | null): boolean {
  const t = minutes(time);
  if (t === null) return false;
  const lo = minutes(min);
  const hi = minutes(max);
  if (lo !== null && hi !== null && hi < lo) return t >= lo || t <= hi;
  if (lo !== null && t < lo) return false;
  if (hi !== null && t > hi) return false;
  return true;
}

/** Minutos desde a meia-noite de um instante no fuso dado; `null` se o fuso for inválido. */
export function localMinutes(instant: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  } catch {
    return null;
  }
}

/**
 * Corte de saída definido por pessoas no card de checkout (Etapa 1, 08/11/2026), em minutos do dia da saída:
 * late checkout FORMAL (R6: horário + aprovação) ou horário definido pela EQUIPE (`staff`) MAIOR que o oficial.
 * `null` = não há corte humano (vale a regra comum). Previsão do hóspede/IA nunca vira corte.
 */
export function staffCheckoutCutMinutes(card: OpsCardState | null, officialCheckout: string | null): number | null {
  if (!card) return null;
  const late = card.lateCheckoutTime && card.lateCheckoutApprovedAt ? minutes(card.lateCheckoutTime) : null;
  if (late !== null) return late;
  if (card.arrivalTimeSource !== "staff") return null;
  const staff = minutes(card.arrivalTimeOverride);
  const official = minutes(officialCheckout);
  if (staff === null || official === null || staff <= official) return null;
  return staff;
}

/** Horário de madrugada (00:00 até 04:59). */
export function isMadrugada(time: string): boolean {
  const t = minutes(time);
  return t !== null && t < MADRUGADA_END_MINUTES;
}

/** Mensagens do hóspede do turno corrente: as do hóspede depois da última mensagem de outro falante. */
function currentGuestBatch(history: readonly OpsHistoryEntry[]): OpsHistoryEntry[] {
  const out: OpsHistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    if (e.speaker !== "guest") break;
    out.unshift(e);
  }
  return out;
}

/** Evidência: ids citados são do hóspede, do turno corrente, e o trecho está literalmente numa delas. */
function checkEvidence(
  input: OpsPolicyInput,
  evidence: readonly string[],
  quote: string | null | undefined,
  kind: LexicalKind,
): { code: OpsRefusalCode | null; messageId: string | null; sentence: string | null } {
  if (!quote || !quote.trim()) return { code: "quote_missing", messageId: null, sentence: null };
  const byRef = new Map(input.history.map((e) => [e.ref, e]));
  const cited = evidence.map((r) => byRef.get(r));
  if (cited.length === 0 || cited.some((e) => !e || e.speaker !== "guest"))
    return { code: "evidence_not_guest", messageId: null, sentence: null };
  const batch = new Set(currentGuestBatch(input.history).map((e) => e.ref));
  const current = (cited as OpsHistoryEntry[]).filter((e) => batch.has(e.ref));
  if (current.length === 0)
    return { code: "evidence_not_current", messageId: null, sentence: null };
  for (const e of current) {
    const sentence = sentenceContaining(e.text, quote);
    if (sentence !== null) {
      const lex = lexicalGuard(sentence, kind);
      return { code: lex, messageId: e.messageId, sentence };
    }
  }
  return { code: "quote_not_in_message", messageId: null, sentence: null };
}

/**
 * Diretriz do titular (07/11/2026): pausa humana, atendente, chamado aberto, problema ou negociação NÃO
 * suspendem os registros nos cards — uma situação não tem a ver com a outra. Só exige o estado da conversa.
 */
function teamOrNegotiationBlock(input: OpsPolicyInput): OpsRefusalCode | null {
  if (!input.conversation) return "state_unavailable";
  return null;
}

function reservationBlock(input: OpsPolicyInput): OpsRefusalCode | null {
  const r = input.reservation;
  if (!r) return "no_reservation";
  const st = (r.status ?? "").toLowerCase();
  if (
    !st ||
    st.includes("cancel") ||
    st.includes("no_show") ||
    st.includes("noshow") ||
    input.phase === "cancelled" ||
    input.phase === "no_show"
  )
    return "reservation_not_active";
  if (!input.timezone) return "no_timezone";
  return null;
}

function cardBlock(card: OpsCardState | null, now: Date): OpsRefusalCode | null {
  if (!card) return null; // sem linha ⇒ pendente
  if (card.status === "done" || card.status === "no_show" || card.doneAt) return "card_done";
  if (card.mutedUntil) {
    const until = Date.parse(card.mutedUntil);
    if (!Number.isFinite(until) || until > now.getTime()) return "card_muted";
  }
  return null;
}

function evaluation(
  action: OpsAction,
  code: OpsRefusalCode | null,
  messageId: string | null,
  card: OpsCardState | null,
  proposed: { date: string | null; time: string | null; madrugada?: boolean } = {
    date: null,
    time: null,
  },
): OpsEvaluation {
  return {
    action,
    outcome: code ? "refused" : "would_apply",
    code,
    evidenceMessageId: messageId,
    proposedDate: proposed.date,
    proposedTime: proposed.time,
    madrugada: proposed.madrugada ?? false,
    cardBefore: card,
  };
}

function evaluateDone(input: OpsPolicyInput, kind: "checkin" | "checkout"): OpsEvaluation {
  const card = input.cards ? input.cards[kind] : null;
  const m = input.decision.hospitalityMilestone!;
  const ev = checkEvidence(
    input,
    m.evidence,
    input.decision.milestoneQuote,
    kind === "checkin" ? "checkin_done" : "checkout_done",
  );
  let action = (kind === "checkin" ? "checkin_done" : "checkout_done") as OpsAction;
  let proposedDate: string | null = null;
  // Saída antecipada: decidida pela data local antes das demais travas (o registro mostra a ação avaliada).
  const today = input.timezone ? localDate(input.now, input.timezone) : null;
  const r = input.reservation;
  if (kind === "checkout" && today && r?.checkoutDate && today < r.checkoutDate) {
    action = "early_departure";
    proposedDate = today;
  }
  const fail = (code: OpsRefusalCode) =>
    evaluation(action, code, ev.messageId, card, { date: proposedDate, time: null });
  if (ev.code) return fail(ev.code);
  const res = reservationBlock(input);
  if (res) return fail(res);
  if (!input.cards) return fail("state_unavailable");
  if (kind === "checkin") {
    // item 5: só com a estadia em curso (depois do horário oficial de entrada, no fuso do imóvel), salvo
    // entrada antecipada combinada expressamente pela equipe no chat, no próprio dia da entrada.
    if (input.phase !== "in_stay") {
      const early =
        input.phase === "pre_stay" &&
        !!today &&
        today === r?.checkinDate &&
        detectStaffEarlyCheckin(
          input.history.map((e) => ({ messageId: e.messageId, speaker: e.speaker, text: e.text, at: e.at ?? "" })),
          { now: input.now },
        ) !== null;
      if (!early) return fail("not_in_stay");
    }
  } else if (action === "early_departure") {
    // item 3: estadia em curso, já depois do dia de entrada, e fato consumado explícito no trecho
    if (input.phase !== "in_stay" || !r!.checkinDate || today! < r!.checkinDate)
      return fail("not_in_stay");
    if (!ev.sentence || !pastDepartureMarker(ev.sentence))
      return fail("early_departure_not_certain");
  } else {
    if (!today || !r!.checkoutDate || today !== r!.checkoutDate) return fail("not_checkout_day");
    if (input.phase !== "in_stay" && input.phase !== "post_checkout")
      return fail("not_checkout_day");
  }
  const cb = cardBlock(card, input.now);
  if (cb) return fail(cb);
  // Etapa 1 (08/11/2026): a IA nunca dá baixa de saída ANTES do horário definido pela equipe (maior que o
  // oficial) nem antes do late checkout autorizado. Saída antecipada (dia anterior) com corte humano também
  // espera: quem fecha é a equipe ou a baixa automática no corte.
  if (kind === "checkout") {
    const cut = staffCheckoutCutMinutes(card, input.property?.checkoutTime ?? null);
    if (cut !== null) {
      if (action === "early_departure") return fail("before_staff_cut");
      const nowMin = input.timezone ? localMinutes(input.now, input.timezone) : null;
      if (nowMin === null || nowMin < cut) return fail("before_staff_cut");
    }
  }
  const team = teamOrNegotiationBlock(input);
  if (team) return fail(team);
  return evaluation(action, null, ev.messageId, card, { date: proposedDate, time: null });
}

function evaluateEta(input: OpsPolicyInput, eta: GuestEta): OpsEvaluation {
  const action: OpsAction = eta.card === "checkin" ? "eta_checkin" : "eta_checkout";
  const card = input.cards ? input.cards[eta.card] : null;
  const r = input.reservation;
  // Madrugada (item 1): chegada 00:00–05:00 é da noite da data de entrada, mesmo que o modelo tenha usado a
  // data civil seguinte. O card proposto é sempre o da data de entrada.
  const madrugada = eta.card === "checkin" && isMadrugada(eta.time);
  const cardDate =
    madrugada && r?.checkinDate && eta.date === addDaysIso(r.checkinDate, 1)
      ? r.checkinDate
      : eta.date;
  const proposed = { date: cardDate, time: eta.time, madrugada };
  const ev = checkEvidence(input, eta.evidence, eta.quote, "eta");
  const fail = (code: OpsRefusalCode) => evaluation(action, code, ev.messageId, card, proposed);
  if (ev.code) return fail(ev.code);
  if (!timeAppearsInQuote(eta.quote, eta.time)) return fail("time_not_in_quote");
  const res = reservationBlock(input);
  if (res) return fail(res);
  if (!input.cards || !input.property) return fail("state_unavailable");
  const expectedDate = eta.card === "checkin" ? r!.checkinDate : r!.checkoutDate;
  if (!expectedDate || cardDate !== expectedDate) return fail("eta_date_mismatch");
  // a previsão só vale até o próprio instante previsto (na madrugada, a data civil é a do dia seguinte)
  const civilDate = madrugada ? addDaysIso(cardDate, 1) : cardDate;
  const today = localDate(input.now, input.timezone!);
  if (!today || !civilDate || today > civilDate) return fail("eta_phase_mismatch");
  if (input.phase !== "pre_stay" && input.phase !== "in_stay") return fail("eta_phase_mismatch");
  const cb = cardBlock(card, input.now);
  if (cb) return fail(cb);
  // a informação mais recente vale, seja da equipe, do guia ou da IA (diretriz 07/11/2026)
  const p = input.property;
  const inBounds =
    eta.card === "checkin"
      ? withinBounds(eta.time, p.checkinTime, p.checkinTimeMax)
      : withinBounds(eta.time, p.checkoutTimeMin, p.checkoutTime);
  if (!inBounds) return fail("eta_out_of_bounds");
  const team = teamOrNegotiationBlock(input);
  if (team) return fail(team);
  return evaluation(action, null, ev.messageId, card, proposed);
}

/**
 * Late checkout concedido pela equipe no chat. `null` = nada a avaliar (sem concessão candidata, ou o card já
 * reflete essa concessão, ou a equipe ajustou o card depois da mensagem).
 */
function evaluateLateCheckout(input: OpsPolicyInput): OpsEvaluation | null {
  const official = input.property?.checkoutTime ?? null;
  const entries = input.history.map((e) => ({
    messageId: e.messageId,
    speaker: e.speaker,
    text: e.text,
    at: e.at ?? "",
  }));
  const cand = detectStaffLateCheckout(entries, { officialCheckout: official, now: input.now });
  if (!cand) return null;
  const card = input.cards ? input.cards.checkout : null;
  if (cand.status === "granted" && card?.lateCheckoutTime === cand.time) return null;
  const decidedAt = card?.lateCheckoutApprovedAt ? Date.parse(card.lateCheckoutApprovedAt) : NaN;
  if (Number.isFinite(decidedAt) && decidedAt >= Date.parse(cand.at)) return null;
  const r = input.reservation;
  const proposed = { date: r?.checkoutDate ?? null, time: cand.time };
  const fail = (code: OpsRefusalCode) =>
    evaluation("late_checkout", code, cand.messageId, card, proposed);
  if (cand.status === "refused") return fail(cand.code);
  const res = reservationBlock(input);
  if (res) return fail(res);
  if (!input.cards) return fail("state_unavailable");
  const today = localDate(input.now, input.timezone!);
  if (!today || !r!.checkoutDate || today > r!.checkoutDate) return fail("not_checkout_window");
  if (input.phase !== "pre_stay" && input.phase !== "in_stay" && input.phase !== "post_checkout")
    return fail("not_checkout_window");
  if (card && (card.status === "done" || card.status === "no_show" || card.doneAt))
    return fail("card_done");
  return evaluation("late_checkout", null, cand.messageId, card, proposed);
}

/** Avalia os sinais operacionais da decisão (v5) e a concessão de late checkout da equipe. */
export function evaluateOpsSignals(input: OpsPolicyInput): OpsEvaluation[] {
  const out: OpsEvaluation[] = [];
  const m = input.decision.hospitalityMilestone;
  if (m) out.push(evaluateDone(input, m.kind === "checkin_confirmed" ? "checkin" : "checkout"));
  for (const eta of input.decision.guestEtas ?? []) out.push(evaluateEta(input, eta));
  const late = evaluateLateCheckout(input);
  if (late) out.push(late);
  return out;
}
