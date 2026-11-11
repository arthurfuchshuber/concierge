/**
 * Calendário de ocupação do imóvel (11/11/2026, caso Gleison: a IA sugeriu reservar uma noite que já tinha outro
 * check-in). Núcleo PURO: monta a ocupação a partir das linhas de reserva já projetadas (sem PII) e responde se
 * uma noite está ocupada. Quem lê o banco é `data/property-calendar.server.ts`; quem usa é o composer (fato
 * `ctx:calendario_ocupacao`) e o validador de texto (`text_calendar_collision`).
 *
 * Convenção de hotelaria: a reserva [entrada, saída) ocupa as NOITES de `entrada` até a véspera de `saida`; no dia
 * da saída a casa fica livre a partir do horário de check-out (por isso uma entrada no mesmo dia é possível).
 */

export const CALENDAR_WINDOW_DAYS = 60;

export interface PropertyOccupancyRange {
  /** YYYY-MM-DD */
  checkin: string;
  /** YYYY-MM-DD */
  checkout: string;
  status: "confirmed" | "blocked";
}

export interface PropertyCalendarOccupancy {
  propertyId: string;
  /** Hoje no fuso do imóvel (YYYY-MM-DD) e o fim da janela consultada. */
  today: string;
  windowEnd: string;
  occupiedRanges: readonly PropertyOccupancyRange[];
  /** Datas (YYYY-MM-DD) em que OUTRA reserva confirmada faz check-in (virada no mesmo dia). */
  sameDayTurnovers: readonly string[];
}

export type CalendarFact = ({ status: "available" } & PropertyCalendarOccupancy) | { status: "unavailable" };

/** Linha mínima de reserva (mesma projeção `RESERVATION_COLUMNS`: sem nome, contato ou valores). */
export interface CalendarRow {
  id: string | null;
  property_id: string | null;
  status: string | null;
  source: string | null;
  checkin_date: string | null;
  checkout_date: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Hoje (YYYY-MM-DD) no fuso IANA do imóvel; `null` sem fuso válido. */
export function localDate(nowIso: string, timeZone: string | null): string | null {
  if (!timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowIso));
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    return y && m && d ? `${y}-${m}-${d}` : null;
  } catch {
    return null;
  }
}

/**
 * Mesma regra de disponibilidade da sincronização com a Channex: reservas confirmadas de qualquer origem e
 * bloqueios MANUAIS do ConciergeIA. Bloqueios históricos do iCal (`source='airbnb'`, `blocked`) espelham o próprio
 * calendário controlado pela Channex e são ignorados; canceladas e duplicadas não ocupam. A reserva da própria
 * conversa (se houver) não conta como "outra" ocupação.
 */
export function buildOccupancy(
  rows: readonly CalendarRow[],
  opts: { propertyId: string; today: string; windowDays?: number; excludeReservationId?: string | null },
): PropertyCalendarOccupancy {
  const windowEnd = addDays(opts.today, opts.windowDays ?? CALENDAR_WINDOW_DAYS);
  const ranges: PropertyOccupancyRange[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.property_id !== opts.propertyId) continue;
    if (opts.excludeReservationId && r.id === opts.excludeReservationId) continue;
    const ci = r.checkin_date ?? "";
    const co = r.checkout_date ?? "";
    if (!ISO_DATE.test(ci) || !ISO_DATE.test(co) || co <= ci) continue;
    if (co <= opts.today || ci > windowEnd) continue;
    let status: PropertyOccupancyRange["status"];
    if (r.status === "confirmed") status = "confirmed";
    else if (r.status === "blocked" && r.source === "manual") status = "blocked";
    else continue;
    const key = `${ci}|${co}|${status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push({ checkin: ci, checkout: co, status });
  }
  ranges.sort((a, b) => (a.checkin === b.checkin ? a.checkout.localeCompare(b.checkout) : a.checkin.localeCompare(b.checkin)));
  const turnovers = [...new Set(ranges.filter((r) => r.status === "confirmed" && r.checkin >= opts.today).map((r) => r.checkin))].sort();
  return { propertyId: opts.propertyId, today: opts.today, windowEnd, occupiedRanges: ranges, sameDayTurnovers: turnovers };
}

/** A NOITE `date` (de `date` para o dia seguinte) está ocupada ou bloqueada? */
export function isNightOccupied(occ: Pick<PropertyCalendarOccupancy, "occupiedRanges">, date: string): boolean {
  return occ.occupiedRanges.some((r) => r.checkin <= date && date < r.checkout);
}

// ─────────────── validação do texto: sugerir noite ocupada (fail-closed, `text_calendar_collision`) ───────────────

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** Oração que SUGERE reservar/selecionar/estender (a orientação ao hóspede, mesmo condicional). */
const SUGGEST = /\b(reserv\w*|selecion\w*|inclu\w*|marqu\w*|marca\w*|escolh\w*|adicion\w*|acrescent\w*|estend\w*|prorrog\w*|diarias?|noites? extras?|ficar ate|permanecer ate|book\w*|select\w*|extend\w*)\b/;
/** Oração que NEGA ou informa ocupação: informação, não sugestão. */
const DENIES = /\b(nao|nunca|indisponive\w*|ocupad\w*|bloquead\w*|ja (ha|tem|existe|esta reservad\w*)|outr[oa] (check.?in|hospede|reserva|entrada)|not|unavailable)\b/;
const DATE_MENTION = new RegExp(
  String.raw`\bdias?\s+(\d{1,2})(?:\/(\d{1,2}))?\b|\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b|\b(\d{1,2}) de (${MONTHS.join("|")})\b`,
  "g",
);
/** "até o dia 21", "saída no dia 21": a última noite é a véspera. */
const EXIT_BEFORE = /\b(ate|saida|sair|saindo|checkout|check out|check-out)\s+(o |no |na |a |em )?(dia )?$/;

function resolveDate(day: number, month: number | null, today: string): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const build = (y: number, m: number) => {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
  };
  if (month !== null) {
    if (month < 1 || month > 12) return null;
    const same = build(ty, month);
    return same && same >= today ? same : build(ty + 1, month);
  }
  if (day >= td) return build(ty, tm);
  return tm === 12 ? build(ty + 1, 1) : build(ty, tm + 1);
}

/**
 * Noites ocupadas que a resposta SUGERE reservar, selecionar ou estender (caso Gleison: "reserve incluindo a
 * diária com saída no dia 21" com outro check-in no dia 20). Só datas explícitas (dia N, N/M, N de mês) dentro da
 * janela consultada; orações que negam ou informam ocupação não contam. Sem calendário ⇒ nada a conferir.
 */
export function findCalendarCollisions(reply: string, occ: Pick<PropertyCalendarOccupancy, "occupiedRanges" | "today" | "windowEnd"> | null | undefined): string[] {
  if (!occ || !reply) return [];
  const out = new Set<string>();
  for (const clause of norm(reply).split(/[.!?;\n]+/)) {
    if (!SUGGEST.test(clause) || DENIES.test(clause)) continue;
    for (const m of clause.matchAll(DATE_MENTION)) {
      const day = Number(m[1] ?? m[3] ?? m[5]);
      const monthRaw = m[2] ?? m[4] ?? (m[6] ? String(MONTHS.indexOf(m[6]) + 1) : null);
      const date = resolveDate(day, monthRaw ? Number(monthRaw) : null, occ.today);
      if (!date || date < occ.today || date > occ.windowEnd) continue;
      const before = clause.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      const night = EXIT_BEFORE.test(before) ? addDays(date, -1) : date;
      if (isNightOccupied(occ, night)) out.add(night);
    }
  }
  return [...out].sort();
}
