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

/* ───────── Calendário em janela própria (29/10/2026, mockups aprovados) ─────────
 * Regra do pedido: o calendário de Bloquear/Liberar só deixa escolher o que dá para
 * FAZER — nada de datas passadas, nada por cima de reserva/bloqueio e, para liberar,
 * SÓ noites de bloqueio manual (nunca de reserva). O resto aparece esmaecido (e
 * riscado quando está ocupado) e não aceita toque. */

/** Noites (YYYY-MM-DD) ocupadas por reservas e bloqueios: checkin … checkout-1. Sem saída, vale a noite do check-in. */
export function occupiedNightSet(stays: readonly StayRange[]): Set<string> {
  const out = new Set<string>();
  for (const s of stays) {
    const end = s.checkout && s.checkout > s.checkin ? s.checkout : addDaysISO(s.checkin, 1);
    let guard = 0;
    for (let d = s.checkin; d < end && guard < 800; d = addDaysISO(d, 1), guard++) out.add(d);
  }
  return out;
}

/**
 * Último "Libera em" possível para um bloqueio que começa em `from`: a primeira noite ocupada
 * a partir dali (o dia de saída pode ser o dia em que a próxima reserva entra — é o "giro"),
 * limitado a 366 noites. Se a própria noite `from` está ocupada, devolve `from` (nenhum fim existe).
 */
export function maxBlockEnd(occupied: ReadonlySet<string>, from: string): string {
  let d = from;
  let n = 0;
  while (n < MAX_BLOCK_NIGHTS && !occupied.has(d)) {
    d = addDaysISO(d, 1);
    n++;
  }
  return d;
}

/** "Entrada" pode ser este dia? Hoje em diante e noite livre. */
export function canPickBlockFrom(occupied: ReadonlySet<string>, todayISO: string, day: string): boolean {
  return day >= todayISO && !occupied.has(day);
}

/** "Libera em" pode ser este dia? Depois da entrada e sem atravessar noite ocupada. */
export function canPickBlockTo(occupied: ReadonlySet<string>, from: string, day: string): boolean {
  return day > from && day <= maxBlockEnd(occupied, from);
}

/** Depois de trocar a entrada: mantém o fim se ainda vale; senão 1 noite depois, ou até onde dá. */
export function normalizeBlockRange(occupied: ReadonlySet<string>, from: string, to: string): { from: string; to: string } {
  const max = maxBlockEnd(occupied, from);
  let t = to;
  if (t <= from) t = addDaysISO(from, 1);
  if (t > max) t = max;
  return { from, to: t };
}

/** Liberar: primeira noite que dá para liberar = a do bloqueio, mas nunca antes de hoje. */
export function releaseFirstNight(block: { from: string }, todayISO: string): string {
  return block.from > todayISO ? block.from : todayISO;
}

/** Liberar — "Entrada" pode ser este dia? Só noite do bloqueio manual (de hoje em diante). */
export function canPickReleaseFrom(block: { from: string; to: string }, todayISO: string, day: string): boolean {
  return day >= releaseFirstNight(block, todayISO) && day < block.to;
}

/** Liberar — "Libera em" pode ser este dia? Depois da entrada, até o fim do bloqueio. */
export function canPickReleaseTo(block: { from: string; to: string }, from: string, day: string): boolean {
  return day > from && day <= block.to;
}

/** Liberar um pedaço: o que sobra do bloqueio original (0, 1 ou 2 bloqueios) para ser recriado. */
export function releaseRemainders(block: { from: string; to: string }, from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (from > block.from) out.push({ from: block.from, to: from });
  if (to < block.to) out.push({ from: to, to: block.to });
  return out;
}
