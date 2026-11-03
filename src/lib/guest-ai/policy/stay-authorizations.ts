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
 * Limitação do contrato atual: revogar limpa as colunas, então revogação e ausência são
 * indistinguíveis (não há `revoked_at`); ambas resultam em não autorizado.
 *
 * Não altera D9, D13 nem R6: a D9 (`credential-policy.ts`) continua usando o seu próprio prazo.
 */
import { isNoShowStatus, isCheckoutConfirmedStatus, normalizeReservationStatus } from "./status";
import { isValidIanaTimezone, parseHm, parseInstant, parseIsoDate, wallClockToInstant } from "./wall-clock";

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
  now: string;
}

const filled = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const deny = (reason: StayAuthDenial) => ({ status: "not_authorized" as const, reason });

/** Ordem de especificidade quando nenhum candidato é válido (o mais grave/estrutural primeiro). */
const CANDIDATE_PRIORITY: readonly StayAuthDenial[] = [
  "other_property",
  "other_reservation",
  "incomplete",
  "invalid_time",
  "approval_timestamp_invalid",
  "approval_in_future",
  "not_after_official",
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
