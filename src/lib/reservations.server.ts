export type CalendarPeriodType = "reservation" | "block";

export type CalendarPeriodRow = {
  checkin_date: string;
  checkout_date: string;
  raw_summary?: string | null;
  status?: string | null;
};

export function operationalTodayISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

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

  for (const row of rows) {
    const type = classifyCalendarPeriod(row);
    if (type !== "reservation") continue;
    if (row.checkin_date === checkin && row.checkout_date === checkout) {
      return { matched: true as const, type };
    }
  }

  return { matched: false as const };
}
