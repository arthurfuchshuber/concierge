/**
 * Fase da hospedagem — derivada no servidor, nunca declarada pelo hóspede nem
 * por um modelo. Pura: recebe instantes já calculados.
 */
import type { StayPhase } from "@/lib/guest-ai/types";
import { normalizeReservationStatus, isNoShowStatus } from "./status";

export interface PhaseInput {
  exists: boolean;
  status: string | null;
  noShow: boolean;
  checkoutConfirmed: boolean;
  checkInAt: Date | null;
  closeAt: Date | null;
  now: Date | null;
}

/** `inquiry` quando não há reserva; `unknown` quando algo necessário não pôde ser comprovado. */
export function deriveStayPhase(i: PhaseInput): StayPhase {
  if (!i.exists) return "inquiry";
  const validity = normalizeReservationStatus(i.status);
  if (validity === "cancelled") return "cancelled";
  if (i.noShow || isNoShowStatus(i.status)) return "no_show";
  if (validity !== "valid") return "unknown";
  if (i.checkoutConfirmed) return "post_checkout";
  if (!i.now || !i.checkInAt || !i.closeAt) return "unknown";
  const t = i.now.getTime();
  if (t > i.closeAt.getTime()) return "post_checkout";
  if (t >= i.checkInAt.getTime()) return "in_stay";
  return "pre_stay";
}
