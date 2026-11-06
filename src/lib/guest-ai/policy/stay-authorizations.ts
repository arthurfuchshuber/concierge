/**
 * F2-B · B2.4 — VERIFICAÇÃO DETERMINÍSTICA das autorizações de HORÁRIO da estadia (pura).
 *
 * Responde, para a conversa/reserva do turno validado, se existe autorização FORMAL, válida e
 * comprovada para (a) entrada antecipada e (b) saída tardia. O modelo NUNCA decide isso: o
 * resultado tipado daqui alimenta o compositor (fatos `ctx:entrada_antecipada`/`ctx:saida_tardia`)
 * e o validador semântico (`COMMITMENT_AUTHORIZATION`).
 *
 * Fontes reais (inspecionadas no esquema em 03/11/2026):
 *  - SAÍDA TARDIA — R6: `guest_arrival_status` (cartão kind='checkout') com `late_checkout_time` +
 *    `late_checkout_approved_at` + `late_checkout_by`, gravados pelo gatilho `guard_stay_authorizations`
 *    (autor = auth.uid(), momento = now()). É a ÚNICA prova aceita. `arrival_time_override` e
 *    `arrival_time_source` (inclusive 'staff') são previsões e NUNCA autorizam.
 *  - ENTRADA ANTECIPADA: NÃO EXISTE fonte formal no banco. A D13 (`credentials_released_at`/`_by` no
 *    cartão de check-in) é liberação manual de CREDENCIAIS (acesso), não autorização de HORÁRIO de
 *    entrada. Por isso o resultado é sempre `not_authorized` (`no_authorization_source`), mesmo com
 *    D13 válida — a separação acesso × horário é preservada. Proposta de evolução no relatório B2.4.
 *
 * Falha fechada: ausente, incompleta, inconsistente, de outra reserva, de outro imóvel, sem autoria,
 * sem integridade temporal (aprovação inválida ou futura), conflitante, consulta indisponível,
 * reserva inválida/cancelada/no-show/checkout confirmado ou fuso inválido ⇒ `not_authorized`.
 * Revogação: revogar limpa as colunas (sem `revoked_at`). B3.2: o loader real lê também o histórico
 * (`audit_logs`, `guest_arrival_status.late_checkout.*`) DEPOIS das colunas; revogação registrada no
 * instante da aprovação lida ou depois ⇒ `revoked_after_approval`; histórico ilegível ⇒ negado. O
 * histórico só nega, nunca concede. Autorização cujo horário já passou ⇒ `expired` (fonte `stale`).
 *
 * Não altera D9, D13 nem R6: a D9 (`credential-policy.ts`) continua usando o seu próprio prazo.
 */
import { isNoShowStatus, isCheckoutConfirmedStatus, normalizeReservationStatus } from "./status";
import { isValidIanaTimezone, parseHm, parseInstant, parseIsoDate, wallClockStatus, wallClockToInstant } from "./wall-clock";

export const STAY_AUTHORIZATION_VERSION = "stay-auth.2026-11-03.1";

export const STAY_AUTH_DENIALS = [
  "lookup_unavailable",
  "no_reservation",
  "reservation_mismatch",
  "property_mismatch",
  "reservation_cancelled",
  "reservation_invalid",
  "no_show",
  "checkout_confirmed",
  "invalid_timezone",
  "official_time_invalid",
  "no_authorization_source",
  "absent",
  "incomplete",
  "other_property",
  "other_reservation",
  "invalid_time",
  "approval_timestamp_invalid",
  "approval_in_future",
  "not_after_official",
  "conflicting",
  // B3.2 — histórico de revogação, vigência e fuso com origem declarada.
  "history_unavailable",
  "history_inconsistent",
  "revoked_after_approval",
  "expired",
] as const;
export type StayAuthDenial = (typeof STAY_AUTH_DENIALS)[number];

export type StayAuthorization =
  | { status: "authorized"; date: string; time: string; approvedAt: string; source: "guest_arrival_status.late_checkout" }
  | { status: "not_authorized"; reason: StayAuthDenial };

export interface StayAuthorizations {
  version: string;
  /** Sempre `not_authorized` nesta fase (sem fonte formal). */
  earlyCheckin: Extract<StayAuthorization, { status: "not_authorized" }>;
  lateCheckout: StayAuthorization;
  /** D13 presente? Informativo: acesso ≠ horário de entrada. */
  credentialManualRelease: "released" | "not_released";
}

/** Linhas como vêm do banco (projeção sem credenciais). */
export interface StayCardRow {
  /** B3.2 — id do cartão (liga o histórico de `audit_logs`). Obrigatório quando há histórico. */
  id?: string | null;
  kind: string | null;
  status: string | null;
  property_id: string | null;
  reservation_id: string | null;
  done_at?: string | null;
  concluded_at?: string | null;
  arrival_time_override?: string | null;
  arrival_time_source?: string | null;
  credentials_released_at?: string | null;
  credentials_released_by?: string | null;
  late_checkout_time?: string | null;
  late_checkout_approved_at?: string | null;
  late_checkout_by?: string | null;
}

export interface StayAuthorizationInput {
  /** Identidade vinda do TURNO validado (nunca do modelo nem do cliente). */
  turn: { propertyId: string; reservationId: string | null };
  /** `"failed"` = a leitura não aconteceu/falhou ⇒ nada é autorizado. */
  lookup: "ok" | "failed";
  reservation: { id: string; property_id: string; status: string | null; checkin_date: string | null; checkout_date: string | null } | null;
  /** Reservas da MESMA estadia (mesmo imóvel + datas), já comprovadas pela camada de dados. */
  stayReservationIds: readonly string[];
  property: { timezone: string | null; checkOutTime: string | null };
  cards: readonly StayCardRow[];
  /**
   * B3.2 — histórico de autorização/revogação (`audit_logs`, ações `guest_arrival_status.late_checkout.*`),
   * lido DEPOIS das colunas do cartão. Só pode NEGAR, nunca conceder. `lookup: "failed"` ⇒ nada
   * autorizado. O loader real sempre fornece; ausente = contrato B2.4 (testes antigos).
   */
  history?: { lookup: "ok" | "failed"; events: ReadonlyArray<{ card_id: string | null; action: string | null; created_at: string | null }> };
  now: string;
}

const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const deny = (reason: StayAuthDenial) => ({ status: "not_authorized" as const, reason });

/** Ordem de especificidade quando nenhum candidato é válido (o mais grave/estrutural primeiro). */
const CANDIDATE_PRIORITY: readonly StayAuthDenial[] = [
  "other_property",
  "other_reservation",
  "revoked_after_approval",
  "history_inconsistent",
  "incomplete",
  "invalid_time",
  "approval_timestamp_invalid",
  "approval_in_future",
  "not_after_official",
  "expired",
];

/** Pré-condições comuns: consulta, reserva do turno, imóvel e estado da estadia. */
function preconditions(i: StayAuthorizationInput): StayAuthDenial | null {
  if (!i || i.lookup !== "ok") return "lookup_unavailable";
  const r = i.reservation;
  if (!r || !i.turn?.reservationId) return "no_reservation";
  if (r.id !== i.turn.reservationId) return "reservation_mismatch";
  if (r.property_id !== i.turn.propertyId) return "property_mismatch";
  const validity = normalizeReservationStatus(r.status);
  if (validity === "cancelled") return "reservation_cancelled";
  const cards = Array.isArray(i.cards) ? i.cards : [];
  const own = cards.filter((c) => c && c.property_id === i.turn.propertyId && (c.reservation_id === r.id || i.stayReservationIds.includes(String(c.reservation_id))));
  if (isNoShowStatus(r.status) || own.some((c) => c.kind === "checkin" && isNoShowStatus(c.status))) return "no_show";
  if (validity !== "valid") return "reservation_invalid";
  if (own.some((c) => c.kind === "checkout" && (isCheckoutConfirmedStatus(c.status) || filled(c.done_at) || filled(c.concluded_at)))) return "checkout_confirmed";
  return null;
}

function verifyLateCheckout(i: StayAuthorizationInput): StayAuthorization {
  const pre = preconditions(i);
  if (pre) return deny(pre);
  const r = i.reservation!;
  const tz = i.property?.timezone;
  if (!isValidIanaTimezone(tz)) return deny("invalid_timezone");
  if (!parseIsoDate(r.checkout_date) || !parseHm(i.property.checkOutTime)) return deny("official_time_invalid");
  const official = wallClockToInstant(r.checkout_date, i.property.checkOutTime, tz, "earlier");
  if (!official) return deny("official_time_invalid");
  const now = parseInstant(i.now);
  if (!now) return deny("lookup_unavailable");

  // Candidatos: cartões de SAÍDA com qualquer campo formal preenchido (previsões não contam).
  const candidates = i.cards.filter((c) => c && c.kind === "checkout" && (filled(c.late_checkout_time) || filled(c.late_checkout_approved_at) || filled(c.late_checkout_by)));
  if (candidates.length === 0) return deny("absent");
  // B3.2 — histórico lido e íntegro é pré-requisito quando fornecido (falha ⇒ nada autorizado).
  const history = i.history;
  if (history && history.lookup !== "ok") return deny("history_unavailable");
  const events = history && Array.isArray(history.events) ? history.events : [];

  const failures: StayAuthDenial[] = [];
  const valid: Array<{ time: string; approvedAt: string }> = [];
  for (const c of candidates) {
    if (c.property_id !== i.turn.propertyId) { failures.push("other_property"); continue; }
    if (c.reservation_id !== r.id && !i.stayReservationIds.includes(String(c.reservation_id))) { failures.push("other_reservation"); continue; }
    if (!filled(c.late_checkout_time) || !filled(c.late_checkout_approved_at) || !filled(c.late_checkout_by)) { failures.push("incomplete"); continue; }
    const time = c.late_checkout_time.trim().slice(0, 5);
    if (!parseHm(time)) { failures.push("invalid_time"); continue; }
    const approved = parseInstant(c.late_checkout_approved_at);
    if (!approved) { failures.push("approval_timestamp_invalid"); continue; }
    if (approved.getTime() > now.getTime()) { failures.push("approval_in_future"); continue; }
    const lateAt = wallClockToInstant(r.checkout_date, time, tz, "earlier");
    if (!lateAt) { failures.push("invalid_time"); continue; }
    if (lateAt.getTime() <= official.getTime()) { failures.push("not_after_official"); continue; }
    if (history) {
      const cardId = filled(c.id) ? c.id : null;
      if (!cardId) { failures.push("history_inconsistent"); continue; }
      const own = events.filter((e) => e && e.card_id === cardId);
      if (own.some((e) => !parseInstant(e.created_at) || typeof e.action !== "string")) { failures.push("history_inconsistent"); continue; }
      // Revogação registrada no mesmo instante ou depois da aprovação lida ⇒ a leitura das colunas
      // está obsoleta ou houve revogação entre as duas leituras: nega (nunca reativa).
      if (own.some((e) => /\.late_checkout\.revoke$/.test(String(e.action)) && parseInstant(e.created_at)!.getTime() >= approved.getTime())) {
        failures.push("revoked_after_approval");
        continue;
      }
    }
    // Vigência: o horário autorizado já passou ⇒ autorização obsoleta (`stale`).
    if (lateAt.getTime() < now.getTime()) { failures.push("expired"); continue; }
    valid.push({ time, approvedAt: approved.toISOString() });
  }
  if (valid.length === 0) return deny(CANDIDATE_PRIORITY.find((p) => failures.includes(p)) ?? "incomplete");
  // Duas autorizações formais com horários diferentes: sem regra de precedência comprovada ⇒ conflito.
  if (new Set(valid.map((v) => v.time)).size > 1) return deny("conflicting");
  return { status: "authorized", date: String(r.checkout_date), time: valid[0]!.time, approvedAt: valid[0]!.approvedAt, source: "guest_arrival_status.late_checkout" };
}

export function evaluateStayAuthorizations(i: StayAuthorizationInput): StayAuthorizations {
  const pre = preconditions(i);
  const cards = i && Array.isArray(i.cards) ? i.cards : [];
  const released =
    !pre &&
    cards.some((c) => c && c.kind === "checkin" && c.property_id === i.turn.propertyId && filled(c.credentials_released_at) && filled(c.credentials_released_by));
  return {
    version: STAY_AUTHORIZATION_VERSION,
    // Entrada antecipada: NÃO há fonte formal. D13 (credenciais) NÃO é autorização de horário.
    earlyCheckin: deny(pre ?? "no_authorization_source"),
    lateCheckout: verifyLateCheckout(i),
    credentialManualRelease: released ? "released" : "not_released",
  };
}

/** Resultado conservador quando a verificação não pôde ser feita (nada é autorizado). */
export function unavailableStayAuthorizations(): StayAuthorizations {
  return { version: STAY_AUTHORIZATION_VERSION, earlyCheckin: deny("lookup_unavailable"), lateCheckout: deny("lookup_unavailable"), credentialManualRelease: "not_released" };
}

// ─────────────────────────── B3.2 — classificação da fonte e regra G.2 ───────────────────────────

/** Estado da FONTE de autorização (vocabulário de `resolveDomain`), derivado do resultado tipado. */
export type StaySourceStatus = "confirmed" | "unknown" | "conflict" | "stale" | "not_applicable";

export function classifyStayAuthorizationSource(a: StayAuthorization): StaySourceStatus {
  if (a.status === "authorized") return "confirmed";
  switch (a.reason) {
    case "conflicting":
    case "revoked_after_approval":
    case "history_inconsistent":
    case "reservation_mismatch":
    case "property_mismatch":
    case "other_property":
    case "other_reservation":
      return "conflict";
    case "expired":
      return "stale";
    case "no_reservation":
    case "reservation_cancelled":
    case "reservation_invalid":
    case "no_show":
    case "checkout_confirmed":
    case "no_authorization_source":
      return "not_applicable";
    default:
      return "unknown";
  }
}

export const REQUESTED_TIME_DENIALS = [
  "not_authorized",
  "scope_mismatch",
  "date_mismatch",
  "timezone_invalid",
  "timezone_mismatch",
  "requested_invalid",
  "requested_nonexistent",
  "requested_ambiguous",
  "authorized_ambiguous",
  "official_unavailable",
  "not_after_official",
  "above_authorized",
] as const;
export type RequestedTimeDenial = (typeof REQUESTED_TIME_DENIALS)[number];
export type RequestedTimeCheck = { status: "within_authorized"; requestedAt: string; authorizedAt: string } | { status: "denied"; reason: RequestedTimeDenial };

/**
 * G.2 (B3.0 Rev. 2 §6.1): `official_checkout < requested_time ≤ authorized_time`, tudo no fuso IANA
 * do imóvel, mesma data local, mesma reserva/imóvel do turno e autorização formal vigente. Horários
 * comparados como INSTANTES (nunca como texto). Horário local inexistente ou ambíguo (horário de
 * verão) ⇒ negado (não há desambiguação formal na fonte).
 */
export function checkRequestedLateCheckout(input: {
  requested: { date: unknown; time: unknown; timezone: unknown; reservationId?: string | null; propertyId?: string | null };
  authorization: StayAuthorization | null | undefined;
  turn: { reservationId: string | null; propertyId: string };
  propertyTimezone: string | null;
  /** Instante do checkout oficial da estadia validada (ISO). */
  officialCheckoutAt: string | null;
}): RequestedTimeCheck {
  const no = (reason: RequestedTimeDenial): RequestedTimeCheck => ({ status: "denied", reason });
  const a = input?.authorization;
  if (!a || a.status !== "authorized") return no("not_authorized");
  const r = input.requested ?? ({} as never);
  if ((r.reservationId != null && r.reservationId !== input.turn.reservationId) || (r.propertyId != null && r.propertyId !== input.turn.propertyId) || !input.turn.reservationId) return no("scope_mismatch");
  const tz = input.propertyTimezone;
  if (!isValidIanaTimezone(tz)) return no("timezone_invalid");
  if (r.timezone !== tz) return no("timezone_mismatch");
  if (typeof r.date !== "string" || r.date !== a.date) return no("date_mismatch");
  const reqStatus = wallClockStatus(r.date, r.time, tz);
  if (reqStatus === "invalid") return no("requested_invalid");
  if (reqStatus === "nonexistent") return no("requested_nonexistent");
  if (reqStatus === "ambiguous") return no("requested_ambiguous");
  if (wallClockStatus(a.date, a.time, tz) !== "valid") return no("authorized_ambiguous");
  const reqAt = wallClockToInstant(r.date, r.time, tz, "earlier");
  const authAt = wallClockToInstant(a.date, a.time, tz, "earlier");
  const official = parseInstant(input.officialCheckoutAt);
  if (!reqAt || !authAt) return no("requested_invalid");
  if (!official) return no("official_unavailable");
  if (reqAt.getTime() <= official.getTime()) return no("not_after_official");
  if (reqAt.getTime() > authAt.getTime()) return no("above_authorized");
  return { status: "within_authorized", requestedAt: reqAt.toISOString(), authorizedAt: authAt.toISOString() };
}
