export type CalendarPeriodType = "reservation" | "block";

export type CalendarPeriodRow = {
  checkin_date: string;
  checkout_date: string;
  raw_summary?: string | null;
  status?: string | null;
};

export function classifyCalendarPeriod(row: CalendarPeriodRow): CalendarPeriodType | null {
  const status = (row.status ?? "").toLowerCase();
  const summary = (row.raw_summary ?? "").toLowerCase();

  if (status.includes("cancel")) return null;
  if (
    status.includes("block") ||
    summary.includes("not available") ||
    summary.includes("unavailable") ||
    summary.includes("bloqueado") ||
    summary.includes("bloqueio")
  ) {
    return "block";
  }

  return "reservation";
}

export function isRealReservation(row: CalendarPeriodRow): boolean {
  return classifyCalendarPeriod(row) === "reservation";
}

export function isAllowedGuidePeriod(rows: CalendarPeriodRow[], checkin: string, checkout: string) {
  if (checkout <= checkin) return { matched: false as const };

  // Merge every valid period (reservation OR block) into contiguous coverage
  // windows. Airbnb host iCal frequently splits a single guest stay across
  // multiple events (e.g. reservation 23-29 + block 29-30 + reservation 30-02
  // for a 23-02 turnover sequence), so we accept any requested [checkin,
  // checkout] range that is fully contained inside one merged window.
  const spans = rows
    .map((r) => ({ type: classifyCalendarPeriod(r), start: r.checkin_date, end: r.checkout_date }))
    .filter((r): r is { type: CalendarPeriodType; start: string; end: string } => !!r.type && r.end > r.start)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const merged: Array<{ start: string; end: string; hasReservation: boolean }> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
      if (s.type === "reservation") last.hasReservation = true;
    } else {
      merged.push({ start: s.start, end: s.end, hasReservation: s.type === "reservation" });
    }
  }

  for (const w of merged) {
    if (checkin >= w.start && checkout <= w.end) {
      return { matched: true as const, type: w.hasReservation ? ("reservation" as const) : ("block" as const) };
    }
  }

  return { matched: false as const };
}