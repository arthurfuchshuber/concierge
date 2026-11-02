/**
 * D9 — POLÍTICA OFICIAL DE LIBERAÇÃO DE CREDENCIAIS.
 *
 * Função PURA, síncrona e determinística: não acessa banco, rede, estado global
 * nem o relógio do sistema; o instante atual chega por parâmetro (`input.now`).
 * Não devolve credenciais: só decide.
 *
 * Ordem OBRIGATÓRIA de precedência (a primeira condição que bate encerra):
 *   VETO 1  reserva inexistente/inválida/cancelada            → deny
 *   VETO 2  no-show (reserva OU cartão de check-in)           → deny (absoluto)
 *   VETO 3  checkout confirmado                               → deny (imediato)
 *   (dados)  fuso / check-in / checkout / `now` não comprovados → deny
 *   VETO 4  agora > corte de checkout (ou late checkout)      → deny
 *   REGRA   agora ≥ check-in oficial − 24 h                   → allow
 *   EXCEÇÃO cartão liberado manualmente pela equipe           → allow
 *   senão                                                     → deny
 *
 * Fronteiras: exatamente 24 h antes = allow; um segundo antes = deny; exatamente
 * no corte de checkout = ainda não vencido; um segundo depois = deny.
 *
 * Qualquer informação crítica ausente ou inválida resulta em BLOQUEIO, nunca em
 * autorização presumida. Fuso e DST: ver `wall-clock.ts`.
 */
import type { AccessPolicyReason, AccessPolicyResult, CredentialPolicyInput } from "@/lib/guest-ai/types";
import { isNoShowStatus, normalizeReservationStatus } from "./status";
import { parseHm, parseInstant, parseIsoDate, wallClockToInstant, isValidIanaTimezone } from "./wall-clock";

export const RELEASE_WINDOW_HOURS = 24;
const HOUR_MS = 3_600_000;

function result(
  reason: AccessPolicyReason,
  allowed: boolean,
  evaluatedAt: string,
  extra?: { releaseAt?: Date | null; closeAt?: Date | null },
): AccessPolicyResult {
  const r: AccessPolicyResult = {
    decision: allowed ? "allow" : "deny",
    allowed,
    reason,
    evaluatedAt,
  };
  if (extra?.releaseAt) r.releaseAt = extra.releaseAt.toISOString();
  if (extra?.closeAt) r.closeAt = extra.closeAt.toISOString();
  return r;
}

export function canReleaseCredentials(input: CredentialPolicyInput): AccessPolicyResult {
  const evaluatedAt = typeof input?.now === "string" ? input.now : "";
  const deny = (reason: AccessPolicyReason, extra?: { releaseAt?: Date | null; closeAt?: Date | null }) =>
    result(reason, false, evaluatedAt, extra);

  // Entrada malformada nunca autoriza.
  if (!input || typeof input !== "object" || !input.reservation || !input.property) {
    return deny("invalid_operational_state");
  }
  const { reservation, property, checkinCard } = input;

  // ── VETO 1 — reserva cancelada ou inexistente/inválida
  if (!reservation.exists) return deny("reservation_invalid");
  const validity = normalizeReservationStatus(reservation.status);
  if (validity === "cancelled") return deny("reservation_cancelled");
  // Uma reserva cujo próprio status já significa "não compareceu" é no-show, não "inválida".
  if (validity !== "valid" && !isNoShowStatus(reservation.status)) return deny("reservation_invalid");

  // ── VETO 2 — no-show (absoluto: nada abaixo o supera)
  if (reservation.noShow === true || checkinCard?.noShow === true || isNoShowStatus(reservation.status)) {
    return deny("no_show");
  }

  // ── VETO 3 — checkout confirmado (corte imediato, mesmo antes do horário previsto)
  if (reservation.checkoutConfirmed === true || reservation.confirmedCheckoutAt) {
    return deny("checkout_confirmed");
  }

  // ── Comprovação dos dados de tempo (falhou = bloqueia)
  const now = parseInstant(input.now);
  if (!now) return deny("invalid_operational_state");
  if (!isValidIanaTimezone(property.timezone)) return deny("missing_timezone");
  const tz = property.timezone;

  const ciDate = parseIsoDate(reservation.checkInDate);
  const ciTime = parseHm(property.checkInTime);
  if (!ciDate || !ciTime) return deny("missing_checkin_time");
  const checkInAt = wallClockToInstant(reservation.checkInDate, property.checkInTime, tz, "later");
  if (!checkInAt) return deny("missing_checkin_time");

  const coDate = parseIsoDate(reservation.checkOutDate);
  const coTime = parseHm(property.officialCheckOutTime);
  if (!coDate || !coTime) return deny("invalid_operational_state");
  if (String(reservation.checkOutDate) < String(reservation.checkInDate)) return deny("invalid_operational_state");
  const officialClose = wallClockToInstant(reservation.checkOutDate, property.officialCheckOutTime, tz, "earlier");
  if (!officialClose) return deny("invalid_operational_state");

  // Late checkout: só vale com registro confiável e válido, e só ESTENDE o prazo.
  let closeAt = officialClose;
  const late = input.authorizedLateCheckout;
  if (late) {
    const lateAt = wallClockToInstant(late.date, late.time, tz, "earlier");
    if (lateAt && lateAt.getTime() > officialClose.getTime()) closeAt = lateAt;
  }

  const releaseAt = new Date(checkInAt.getTime() - RELEASE_WINDOW_HOURS * HOUR_MS);
  const diag = { releaseAt, closeAt };

  // ── VETO 4 — horário limite de checkout ultrapassado
  if (now.getTime() > closeAt.getTime()) return deny("checkout_expired", diag);

  // ── REGRA PADRÃO — janela de 24 h
  if (now.getTime() >= releaseAt.getTime()) return result("within_release_window", true, evaluatedAt, diag);

  // ── EXCEÇÃO — liberação manual (registro operacional confiável; nunca supera os vetos acima)
  if (checkinCard?.released === true) return result("manual_release", true, evaluatedAt, diag);

  return deny("outside_release_window", diag);
}
