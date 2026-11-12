/**
 * Calendário de ocupação do imóvel (11/11/2026, caso Gleison: a IA sugeriu reservar uma noite que já tinha outro
 * check-in). Núcleo PURO: monta a ocupação a partir das linhas de reserva já projetadas (sem PII) e responde se
 * uma noite está ocupada. Quem lê o banco é `data/property-calendar.server.ts`; quem usa é o composer (fato
 * `ctx:calendario_ocupacao`) e o validador de texto (`text_calendar_collision`).
 *
 * Convenção de hotelaria: a reserva [entrada, saída) ocupa as NOITES de `entrada` até a véspera de `saida`; no dia
 * da saída a casa fica livre a partir do horário de check-out (por isso uma entrada no mesmo dia é possível).
 */

/** Sem estadia e sem datas citadas: os próximos 14 dias. */
export const DEFAULT_LOOKAHEAD_DAYS = 14;
/** Com estadia: da véspera da entrada até 3 dias após a saída (checagem de prorrogação). */
export const STAY_AFTER_CHECKOUT_DAYS = 3;

export interface PropertyOccupancyRange {
  /** YYYY-MM-DD */
  checkin: string;
  /** YYYY-MM-DD */
  checkout: string;
  status: "confirmed" | "blocked";
}

/** Resumo determinístico da estadia da conversa (viradas no mesmo dia e prorrogação). */
export interface StayTurnoverSummary {
  checkin: string;
  checkout: string;
  /** Outro hóspede SAI no dia da nossa entrada (entrada antecipada depende da higienização). */
  sameDayDepartureOnCheckin: boolean;
  /** Outro hóspede ENTRA no dia da nossa saída (saída pontual no horário oficial). */
  sameDayArrivalOnCheckout: boolean;
  /** As noites seguintes à saída (até o fim da janela) estão livres no nosso calendário. */
  isExtensionAvailable: boolean;
}

export interface MentionedDateSummary {
  date: string;
  nightOccupied: boolean;
  otherCheckinOnDay: boolean;
}

export interface PropertyCalendarOccupancy {
  propertyId: string;
  /** Hoje no fuso do imóvel (YYYY-MM-DD). */
  today: string;
  /** Janela DINÂMICA consultada (estadia, datas citadas pelo hóspede ou próximos 14 dias). */
  windowStart: string;
  windowEnd: string;
  /** Períodos ocupados na janela (reservas confirmadas e bloqueios manuais), só datas. */
  occupiedRanges: readonly PropertyOccupancyRange[];
  /** Datas (YYYY-MM-DD) em que OUTRA reserva confirmada faz check-in (virada no mesmo dia). */
  sameDayTurnovers: readonly string[];
  stay: StayTurnoverSummary | null;
  mentionedDates: readonly MentionedDateSummary[];
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
 * Janela dinâmica (diretiva de 11/11/2026): sem teto fixo de dias. Com estadia, da véspera da entrada até 3 dias
 * após a saída; com datas citadas pelo hóspede, exatamente o intervalo citado (±1 dia para as viradas), mesmo
 * meses à frente; as duas se somam. Sem nenhuma das duas, os próximos 14 dias.
 */
export function calendarWindow(opts: {
  today: string;
  stay?: { checkin: string; checkout: string } | null;
  mentionedDates?: readonly string[];
}): { start: string; end: string } {
  const points: string[] = [];
  if (opts.stay) points.push(addDays(opts.stay.checkin, -1), addDays(opts.stay.checkout, STAY_AFTER_CHECKOUT_DAYS));
  const mentioned = [...(opts.mentionedDates ?? [])].sort();
  if (mentioned.length) points.push(addDays(mentioned[0]!, -1), addDays(mentioned[mentioned.length - 1]!, 1));
  if (!points.length) return { start: opts.today, end: addDays(opts.today, DEFAULT_LOOKAHEAD_DAYS) };
  points.sort();
  return { start: points[0]!, end: points[points.length - 1]! };
}

/**
 * Mesma regra de disponibilidade da sincronização com a Channex: reservas confirmadas de qualquer origem e
 * bloqueios MANUAIS do ConciergeIA. Bloqueios históricos do iCal (`source='airbnb'`, `blocked`) espelham o próprio
 * calendário controlado pela Channex e são ignorados; canceladas e duplicadas não ocupam. A reserva da própria
 * conversa (se houver) não conta como "outra" ocupação. Anúncios gêmeos não têm imóvel próprio no ConciergeIA:
 * as reservas deles entram no `property_id` do imóvel principal, então o filtro por imóvel cobre a unidade física.
 */
export function buildOccupancy(
  rows: readonly CalendarRow[],
  opts: {
    propertyId: string;
    today: string;
    windowStart?: string;
    windowEnd?: string;
    excludeReservationId?: string | null;
    stay?: { checkin: string; checkout: string } | null;
    mentionedDates?: readonly string[];
  },
): PropertyCalendarOccupancy {
  const win = calendarWindow({ today: opts.today, stay: opts.stay, mentionedDates: opts.mentionedDates });
  const windowStart = opts.windowStart ?? win.start;
  const windowEnd = opts.windowEnd ?? win.end;
  const ranges: PropertyOccupancyRange[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.property_id !== opts.propertyId) continue;
    if (opts.excludeReservationId && r.id === opts.excludeReservationId) continue;
    const ci = r.checkin_date ?? "";
    const co = r.checkout_date ?? "";
    if (!ISO_DATE.test(ci) || !ISO_DATE.test(co) || co <= ci) continue;
    if (co <= windowStart || ci > windowEnd) continue;
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
  const turnovers = [...new Set(ranges.filter((r) => r.status === "confirmed" && r.checkin >= windowStart).map((r) => r.checkin))].sort();
  const base = { occupiedRanges: ranges };
  const stay: StayTurnoverSummary | null = opts.stay
    ? {
        checkin: opts.stay.checkin,
        checkout: opts.stay.checkout,
        sameDayDepartureOnCheckin: ranges.some((r) => r.status === "confirmed" && r.checkout === opts.stay!.checkin),
        sameDayArrivalOnCheckout: turnovers.includes(opts.stay.checkout),
        isExtensionAvailable: (() => {
          for (let d = opts.stay!.checkout; d < windowEnd; d = addDays(d, 1)) if (isNightOccupied(base, d)) return false;
          return true;
        })(),
      }
    : null;
  const mentionedDates = [...new Set(opts.mentionedDates ?? [])]
    .sort()
    .map((d) => ({ date: d, nightOccupied: isNightOccupied(base, d), otherCheckinOnDay: turnovers.includes(d) }));
  return { propertyId: opts.propertyId, today: opts.today, windowStart, windowEnd, occupiedRanges: ranges, sameDayTurnovers: turnovers, stay, mentionedDates };
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
export function findCalendarCollisions(
  reply: string,
  occ: Pick<PropertyCalendarOccupancy, "occupiedRanges" | "today" | "windowStart" | "windowEnd"> | null | undefined,
): string[] {
  if (!occ || !reply) return [];
  const out = new Set<string>();
  for (const clause of norm(reply).split(/[.!?;\n]+/)) {
    if (!SUGGEST.test(clause) || DENIES.test(clause)) continue;
    for (const m of clause.matchAll(DATE_MENTION)) {
      const day = Number(m[1] ?? m[3] ?? m[5]);
      const monthRaw = m[2] ?? m[4] ?? (m[6] ? String(MONTHS.indexOf(m[6]) + 1) : null);
      const date = resolveDate(day, monthRaw ? Number(monthRaw) : null, occ.today);
      if (!date) continue;
      const before = clause.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      const night = EXIT_BEFORE.test(before) ? addDays(date, -1) : date;
      // só o que foi consultado: fora da janela não se afirma nada (nem colisão)
      if (night < occ.windowStart || night > occ.windowEnd) continue;
      if (isNightOccupied(occ, night)) out.add(night);
    }
  }
  return [...out].sort();
}

// ─────────────── recorte enxuto para o prompt (diretiva 11/11/2026: menos tokens, resumo determinístico) ───────────────

/** Datas explícitas citadas num texto (dia N, N/M, N de mês), resolvidas a partir de `today`. */
export function extractMentionedDates(text: string, today: string): string[] {
  const out = new Set<string>();
  for (const m of norm(text ?? "").matchAll(DATE_MENTION)) {
    const day = Number(m[1] ?? m[3] ?? m[5]);
    const monthRaw = m[2] ?? m[4] ?? (m[6] ? String(MONTHS.indexOf(m[6]) + 1) : null);
    const d = resolveDate(day, monthRaw ? Number(monthRaw) : null, today);
    if (d) out.add(d);
  }
  return [...out].sort();
}

/** O fato `ctx:calendario_ocupacao` (só datas; nada de outros hóspedes). */
export function calendarFactValue(occ: PropertyCalendarOccupancy): Record<string, unknown> {
  return {
    status: "consultado",
    hoje: occ.today,
    janela: { de: occ.windowStart, ate: occ.windowEnd },
    intervalos_ocupados: occ.occupiedRanges.map((r) => ({
      entrada: r.checkin,
      saida: r.checkout,
      tipo: r.status === "confirmed" ? "reserva_confirmada" : "bloqueio",
    })),
    dias_com_outro_checkin: [...occ.sameDayTurnovers],
    ...(occ.stay
      ? {
          estadia: {
            entrada: occ.stay.checkin,
            saida: occ.stay.checkout,
            outra_saida_no_dia_da_entrada: occ.stay.sameDayDepartureOnCheckin,
            outra_entrada_no_dia_da_saida: occ.stay.sameDayArrivalOnCheckout,
            prorrogacao_livre: occ.stay.isExtensionAvailable,
          },
        }
      : {}),
    ...(occ.mentionedDates.length
      ? { datas_citadas: occ.mentionedDates.map((m) => ({ data: m.date, noite_ocupada: m.nightOccupied, outro_checkin_no_dia: m.otherCheckinOnDay })) }
      : {}),
    leitura: "noite D ocupada se entrada <= D < saida; fora dos intervalos = livre no nosso calendário (a plataforma tem a palavra final); fora da janela, não se sabe",
  };
}
