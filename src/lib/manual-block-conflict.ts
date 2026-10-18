/**
 * Regra única de conflito do BLOQUEIO MANUAL do calendário (17/10/2026).
 *
 * Um bloqueio "de A até B" ocupa as NOITES A … B-1 (B = dia de saída, como em
 * uma reserva). Uma reserva ativa ocupa as noites checkin … checkout-1. Os
 * dois se chocam quando compartilham pelo menos uma noite:
 *   reserva.checkin < B  &&  reserva.checkout > A
 * (checkout no dia A, ou check-in no dia B, NÃO conflita — é o "giro").
 *
 * O calendário usa isso para avisar na hora; o servidor usa a MESMA função
 * como trava final (`createManualBlock`), então um clique atrasado ou uma
 * chamada direta nunca bloqueiam por cima de hóspede.
 */
export type StayRange = { checkin: string; checkout: string | null; guest?: string | null };

export function firstBlockConflict<T extends StayRange>(stays: readonly T[], from: string, to: string): T | null {
  let best: T | null = null;
  for (const s of stays) {
    const end = s.checkout ?? s.checkin;
    if (s.checkin < to && end > from && (!best || s.checkin < best.checkin)) best = s;
  }
  return best;
}

/** Primeira noite em choque (YYYY-MM-DD) — a data que a mensagem de erro mostra. */
export function conflictNight(stay: StayRange, from: string): string {
  return stay.checkin > from ? stay.checkin : from;
}

/** Noites cobertas por [from, to). */
export function blockNights(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const ddmmISO = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function conflictMessage(stay: StayRange, from: string): string {
  const who = stay.guest?.trim();
  return `O dia ${ddmmISO(conflictNight(stay, from))} já tem reserva ativa${who ? ` (${who})` : ""}.`;
}
