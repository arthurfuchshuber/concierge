/**
 * Fatos operacionais da reserva (PURO): transforma as linhas do banco no estado
 * que a política D9 consome. Sem acesso a banco/relógio.
 *
 * Origem de cada fato (verificada no código e no banco em 02/11/2026):
 *  - no-show: `guest_arrival_status` kind='checkin' status='no_show'. O `markNoShow`
 *    do painel grava só o id do cartão clicado, então a busca cobre a reserva, as
 *    reservas irmãs da MESMA estadia (imóvel + check-in + check-out) e os
 *    formulários do hóspede da mesma data de entrada (mesma chave por estadia da esteira).
 *  - checkout confirmado: `guest_arrival_status` kind='checkout' com status done/no_show,
 *    `done_at` ou `concluded_at`. `concluded_at` em cartão de CHECK-IN NÃO conta: lá ele só
 *    esconde o cartão (57 cartões de check-in pendentes já têm `concluded_at`).
 *  - late checkout: kind='checkout' com `arrival_time_source='staff'` e `arrival_time_override`
 *    válido (previsão gravada pela equipe). Fonte 'guest' ou 'ai' NÃO é autorização.
 *  - liberação manual do cartão de check-in (D13, migração de 02/11/2026): cartão de CHECK-IN da
 *    mesma estadia com `credentials_released_at` preenchido. Revogar = limpar a coluna. A liberação
 *    nunca supera os vetos da D9 (no-show, checkout, prazo), que são avaliados antes dela.
 */
import { isCheckoutConfirmedStatus, isNoShowStatus, normalizeReservationStatus } from "@/lib/guest-ai/policy/status";
import { parseHm, parseIsoDate } from "@/lib/guest-ai/policy/wall-clock";

export interface ReservationRow {
  id: string;
  property_id: string;
  status: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
}

export interface ArrivalStatusRow {
  kind: string | null;
  status: string | null;
  done_at: string | null;
  concluded_at: string | null;
  arrival_time_override: string | null;
  arrival_date_override: string | null;
  arrival_time_source: string | null;
  reservation_id: string | null;
  log_id: string | null;
  /** D13: quando a equipe liberou manualmente as credenciais neste cartão (null = não liberado). */
  credentials_released_at?: string | null;
}

export interface ReservationState {
  exists: boolean;
  reservationId: string | null;
  propertyId: string | null;
  status: string | null;
  source: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  noShow: boolean;
  checkoutConfirmed: boolean;
  confirmedCheckoutAt: string | null;
  authorizedLateCheckout: { date: string; time: string } | null;
  checkinCard: { released: boolean; noShow: boolean } | null;
  /** Origem da liberação manual (registro operacional confiável no banco). */
  manualReleaseSource: "guest_arrival_status.credentials_released_at";
}

export function emptyReservationState(): ReservationState {
  return {
    exists: false,
    reservationId: null,
    propertyId: null,
    status: null,
    source: null,
    checkInDate: null,
    checkOutDate: null,
    noShow: false,
    checkoutConfirmed: false,
    confirmedCheckoutAt: null,
    authorizedLateCheckout: null,
    checkinCard: null,
    manualReleaseSource: "guest_arrival_status.credentials_released_at",
  };
}

function earliest(values: Array<string | null>): string | null {
  const ok = values.filter((v): v is string => typeof v === "string" && v.length > 0).sort();
  return ok[0] ?? null;
}

export function deriveReservationFacts(res: ReservationRow | null, statusRows: ArrivalStatusRow[]): ReservationState {
  if (!res) return emptyReservationState();

  const checkinRows = statusRows.filter((r) => r.kind === "checkin");
  const checkoutRows = statusRows.filter((r) => r.kind === "checkout");

  const noShow = checkinRows.some((r) => isNoShowStatus(r.status));
  // D13: liberação manual = registro da equipe no cartão de CHECK-IN desta estadia.
  const released = checkinRows.some((r) => typeof r.credentials_released_at === "string" && r.credentials_released_at.length > 0);

  const confirmedRows = checkoutRows.filter(
    (r) => isCheckoutConfirmedStatus(r.status) || !!r.done_at || !!r.concluded_at,
  );
  const checkoutConfirmed = confirmedRows.length > 0;
  const confirmedCheckoutAt = earliest(confirmedRows.flatMap((r) => [r.done_at, r.concluded_at]));

  // Late checkout: previsão da EQUIPE, ainda pendente, com horário válido. Vale o mais tarde.
  let late: { date: string; time: string } | null = null;
  for (const r of checkoutRows) {
    if (r.arrival_time_source !== "staff" || confirmedRows.includes(r)) continue;
    if (!parseHm(r.arrival_time_override)) continue;
    const date = r.arrival_date_override ?? res.checkout_date;
    if (!parseIsoDate(date)) continue;
    const cand = { date: String(date), time: String(r.arrival_time_override).slice(0, 5) };
    if (!late || `${cand.date}T${cand.time}` > `${late.date}T${late.time}`) late = cand;
  }

  return {
    exists: true,
    reservationId: res.id,
    propertyId: res.property_id,
    status: res.status,
    source: res.source,
    checkInDate: res.checkin_date,
    checkOutDate: res.checkout_date,
    noShow,
    checkoutConfirmed,
    confirmedCheckoutAt,
    authorizedLateCheckout: late,
    checkinCard: checkinRows.length > 0 ? { released, noShow } : null,
    manualReleaseSource: "guest_arrival_status.credentials_released_at",
  };
}

/** A reserva é elegível para fase/liberação? (status confirmado). */
export function reservationIsValid(state: ReservationState): boolean {
  return state.exists && normalizeReservationStatus(state.status) === "valid";
}
