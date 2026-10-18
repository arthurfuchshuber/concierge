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

/* ───────── Regras do servidor (mesmas de `activeBookingNights`) ───────── */

export type ReservationRow = { checkin_date: string | null; checkout_date: string | null; status: string | null; source: string | null };

/**
 * Quais linhas de `property_reservations` contam como HÓSPEDE para o conflito.
 * Espelha `activeBookingNights` (channex-mapping.server): cancelada nunca conta;
 * bloqueio (manual/iCal "Not available") não é hóspede; iCal do Airbnb só conta
 * quando confirmado.
 */
export function activeStays(rows: readonly ReservationRow[]): StayRange[] {
  const out: StayRange[] = [];
  for (const r of rows) {
    const status = String(r.status ?? "").toLowerCase();
    if (status.includes("cancel") || status === "blocked") continue;
    if (String(r.source ?? "") === "airbnb" && status !== "confirmed") continue;
    if (!r.checkin_date || !r.checkout_date) continue;
    out.push({ checkin: r.checkin_date, checkout: r.checkout_date });
  }
  return out;
}

export type ExistingBlock = { id: string; from: string; to: string };

/**
 * Bloqueio novo sobre bloqueios que já existem: se um deles já cobre tudo, não
 * cria nada; se tocam/sobrepõem (inclusive encostando: um termina onde o outro
 * começa), vira UM bloqueio só (união) e os absorvidos são cancelados.
 */
export function planBlockMerge(existing: readonly ExistingBlock[], from: string, to: string) {
  const covering = existing.find((b) => b.from <= from && b.to >= to);
  if (covering) return { coveringId: covering.id, from, to, absorbIds: [] as string[] };
  let lo = from;
  let hi = to;
  const absorbIds: string[] = [];
  for (const b of existing) {
    if (b.from <= to && b.to >= from) {
      absorbIds.push(b.id);
      if (b.from < lo) lo = b.from;
      if (b.to > hi) hi = b.to;
    }
  }
  return { coveringId: null as string | null, from: lo, to: hi, absorbIds };
}

/** Primeira noite de [from, to) presente em `nights` (ou null). */
export function firstNightIn(nights: ReadonlySet<string>, from: string, to: string): string | null {
  for (let d = from; d < to; d = addDaysISO(d, 1)) if (nights.has(d)) return d;
  return null;
}

const MAX_BLOCK_NIGHTS = 366;

/** Validação de datas do pedido. `todayISO` em UTC; 1 dia de folga por causa do fuso do Brasil. */
export function validateBlockDates(from: string, to: string, todayISO: string): string | null {
  if (!(to > from)) return "A data final precisa ser depois da inicial.";
  if (from < addDaysISO(todayISO, -1)) return "Escolha uma data a partir de hoje.";
  if (blockNights(from, to) > MAX_BLOCK_NIGHTS) return "O bloqueio pode ter no máximo 366 noites por vez.";
  return null;
}
