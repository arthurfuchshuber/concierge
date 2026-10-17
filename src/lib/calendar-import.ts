// Calendário do Airbnb IMPORTADO (somente leitura). Funções puras: transformam o que a Channex
// entrega (webhook `ari` e GET /restrictions + /availability) em linhas de `channex_calendar_import`.
type Any = Record<string, any>;

export type CalendarRow = {
  rate_plan_id: string;
  date: string;
  room_type_id: string | null;
  channex_property_id: string | null;
  availability?: number | null;
  booked?: number | null;
  stop_sell?: boolean | null;
  rate?: number | null;
  min_stay?: number | null;
  max_stay?: number | null;
  closed_to_arrival?: boolean | null;
  closed_to_departure?: boolean | null;
};

const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** Uma entrada de ARI (webhook ou GET) vira uma linha; só entram os campos que vieram. */
export function rowFromAri(entry: Any, ctx: { channexPropertyId?: string | null; ratePlanId?: string; roomTypeId?: string; date?: string }): CalendarRow | null {
  const ratePlan = String(entry.rate_plan_id ?? ctx.ratePlanId ?? "");
  const date = String(entry.date ?? ctx.date ?? "").slice(0, 10);
  if (!ratePlan || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const row: CalendarRow = {
    rate_plan_id: ratePlan,
    date,
    room_type_id: (entry.room_type_id ?? ctx.roomTypeId ?? null) as string | null,
    channex_property_id: ctx.channexPropertyId ?? null,
  };
  const set = <K extends keyof CalendarRow>(k: K, v: CalendarRow[K] | undefined) => {
    if (v !== undefined) row[k] = v;
  };
  set("availability", num(entry.availability));
  set("booked", num(entry.booked));
  set("stop_sell", bool(entry.stop_sell));
  set("rate", num(entry.rate));
  set("min_stay", num(entry.min_stay_arrival ?? entry.min_stay_through ?? entry.min_stay));
  set("max_stay", num(entry.max_stay));
  set("closed_to_arrival", bool(entry.closed_to_arrival));
  set("closed_to_departure", bool(entry.closed_to_departure));
  return row;
}

export function rowsFromWebhook(payload: unknown): CalendarRow[] {
  const root = (payload ?? {}) as Any;
  const list = Array.isArray(root.payload) ? (root.payload as Any[]) : [];
  const channexPropertyId = typeof root.property_id === "string" ? root.property_id : null;
  return list.map((e) => rowFromAri(e, { channexPropertyId })).filter((r): r is CalendarRow => !!r);
}

/** GET /restrictions => data[ratePlanId][date] = {rate, min_stay_arrival, ...}. */
export function rowsFromRestrictions(data: Any | null | undefined, channexPropertyId: string): CalendarRow[] {
  const out: CalendarRow[] = [];
  for (const [rp, days] of Object.entries(data ?? {})) {
    for (const [date, v] of Object.entries((days ?? {}) as Any)) {
      const r = rowFromAri((v ?? {}) as Any, { channexPropertyId, ratePlanId: rp, date });
      if (r) out.push(r);
    }
  }
  return out;
}

/** GET /availability => data[roomTypeId][date] = n. Vira linhas para todos os planos do quarto. */
export function rowsFromAvailability(data: Any | null | undefined, channexPropertyId: string, plansByRoom: Record<string, string[]>): CalendarRow[] {
  const out: CalendarRow[] = [];
  for (const [rt, days] of Object.entries(data ?? {})) {
    for (const [date, n] of Object.entries((days ?? {}) as Any)) {
      for (const rp of plansByRoom[rt] ?? []) {
        const r = rowFromAri({ availability: typeof n === "object" && n ? (n as Any).availability : n }, { channexPropertyId, ratePlanId: rp, roomTypeId: rt, date });
        if (r) out.push(r);
      }
    }
  }
  return out;
}

/** Agrupa por conjunto de colunas, para o upsert nunca zerar o que não veio. */
export function groupByShape(rows: CalendarRow[]): CalendarRow[][] {
  const g = new Map<string, CalendarRow[]>();
  for (const r of rows) {
    const k = Object.keys(r).sort().join(",");
    g.set(k, [...(g.get(k) ?? []), r]);
  }
  return [...g.values()];
}
