/**
 * Mapeamento CENTRAL de estados operacionais reais → estados normalizados.
 *
 * Valores realmente encontrados no banco de produção (02/11/2026):
 *  - `property_reservations.status`: confirmed, cancelled, cancelled_duplicate, blocked
 *  - `reservas.status` (webhook Channex): new, modified, cancelled
 *  - `guest_arrival_status.status`: pending, done, no_show (este só em kind='checkin')
 * As variantes extras de no-show ("nao_compareceu", "nao_comparecera") vêm do texto
 * do documento de requisitos e ainda não existem no banco; ficam aqui para que um
 * valor equivalente futuro NUNCA passe despercebido.
 */

export type ReservationValidity = "valid" | "cancelled" | "invalid";

function key(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_");
}

const CANCELLED = new Set(["cancelled", "canceled", "cancelled_duplicate", "cancelada", "cancelado"]);
/** Só "confirmed" é uma reserva de hóspede válida; "blocked" é bloqueio de calendário, não reserva. */
const VALID = new Set(["confirmed"]);

export function normalizeReservationStatus(status: unknown): ReservationValidity {
  const k = key(status);
  if (CANCELLED.has(k)) return "cancelled";
  if (VALID.has(k)) return "valid";
  return "invalid";
}

const NO_SHOW = new Set(["no_show", "noshow", "nao_compareceu", "nao_comparecera"]);

/** O estado do cartão/reserva equivale a "não compareceu"? */
export function isNoShowStatus(status: unknown): boolean {
  return NO_SHOW.has(key(status));
}

const DONE = new Set(["done", "concluded", "concluido", "confirmed"]);

/** O estado de um cartão de CHECKOUT equivale a "saída confirmada"? (no_show no checkout também encerra, como na esteira.) */
export function isCheckoutConfirmedStatus(status: unknown): boolean {
  const k = key(status);
  return DONE.has(k) || NO_SHOW.has(k);
}
