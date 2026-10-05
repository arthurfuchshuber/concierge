/**
 * PREVISÃO DE DATA × DATA DA RESERVA.
 *
 * `guest_arrival_status.arrival_date_override` é a previsão de chegada/saída
 * num dia diferente do da reserva. Ela só faz sentido em relação à data da
 * reserva em que foi dada: `arrival_date_base` guarda essa data.
 *
 * Se o calendário (Airbnb) muda a data da reserva depois — o hóspede
 * prorrogou, por exemplo — a previsão antiga ficou velha: a reserva é a fonte
 * da verdade e a previsão deixa de valer. Antes disto o card ficava preso no
 * dia antigo e a saída automática confirmava a saída por engano.
 *
 * Sem base (linhas antigas, quando não dava para saber) a previsão continua
 * valendo como sempre.
 */
export function liveDateOverride(
  override: string | null | undefined,
  base: string | null | undefined,
  currentReservationDate: string | null | undefined,
): string | null {
  if (!override) return null;
  if (base && currentReservationDate && base !== currentReservationDate) return null;
  return override;
}

/** A previsão existe mas ficou velha porque a reserva mudou de data. */
export function isStaleDateOverride(
  override: string | null | undefined,
  base: string | null | undefined,
  currentReservationDate: string | null | undefined,
): boolean {
  return !!override && !!base && !!currentReservationDate && base !== currentReservationDate;
}
