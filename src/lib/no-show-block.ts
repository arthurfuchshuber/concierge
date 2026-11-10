/**
 * Regra do "Não Compareceu" que trava a liberação de um novo check-in (pedido de 15/09/2026: o no-show NÃO
 * libera o imóvel enquanto a reserva não for cancelada).
 *
 * CORREÇÃO (09/11/2026, Studio 104): o recorte era `saída >= hoje`. Um no-show de 07→09/11 tinha saída HOJE e
 * travava a chegada que começa também em 09/11 — duas estadias que NÃO se sobrepõem (a troca no mesmo dia é o
 * normal do negócio). Agora só trava quando a estadia do no-show invade o período do novo check-in:
 * a saída dela precisa ser DEPOIS da entrada do novo hóspede (saída no mesmo dia da entrada = imóvel livre).
 */
export interface NoShowStay {
  /** Data de saída (YYYY-MM-DD) da estadia do no-show; desconhecida ⇒ não trava. */
  checkoutDate: string | null;
  /** Data de entrada da estadia do no-show, se conhecida. */
  checkinDate?: string | null;
  hasReservation: boolean;
  reservationStatus?: string | null;
}

export function noShowBlocksCheckin(stay: NoShowStay, newCheckinDate: string | null, today: string): boolean {
  if (!stay.checkoutDate) return false;
  const novaEntrada = newCheckinDate ?? today;
  // Estadia do no-show já terminou (ou termina no dia em que o novo hóspede entra): imóvel livre.
  if (stay.checkoutDate <= novaEntrada) return false;
  // Sem reserva vinculada não há como comprovar cancelamento → bloqueia.
  if (!stay.hasReservation) return true;
  return !(stay.reservationStatus ?? "").toLowerCase().includes("cancel");
}
