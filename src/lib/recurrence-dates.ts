// Datas das recorrências (13/11/2026). Tudo em texto AAAA-MM-DD, sem fuso: a conta é de calendário.
export type RecurrenceUnit = "day" | "week" | "month" | "year";

const pad = (n: number) => String(n).padStart(2, "0");
function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}
export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000);
}

/** Próxima data da série depois de `iso`. Mês mais curto usa o último dia ("dia 31" em fevereiro = 28/29). */
export function advance(iso: string, unit: RecurrenceUnit, n: number, anchorDay: number): string {
  if (unit === "day") return addDays(iso, n);
  if (unit === "week") return addDays(iso, 7 * n);
  const [y, m] = parts(iso);
  const months = unit === "year" ? 12 * n : n;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(anchorDay, daysInMonth(ny, nm)))}`;
}

/**
 * CHECKOUT QUE RECEBE A PENDÊNCIA (regra do cliente, 13/11/2026): o mais próximo da data prevista,
 * antes ou depois. Empate de distância = o mais cedo. Limpeza no próprio dia vence sempre. Só entram
 * checkouts de hoje em diante; se a data já passou, vale o próximo checkout a partir de hoje.
 */
export function pickCleaningDate(due: string, today: string, checkouts: string[]): string | null {
  const future = checkouts.filter((c) => c >= today).sort();
  if (future.length === 0) return null;
  if (future.includes(due)) return due;
  const ref = due < today ? today : due;
  let best = future[0];
  let bestDist = Math.abs(diffDays(best, ref));
  for (const c of future.slice(1)) {
    const d = Math.abs(diffDays(c, ref));
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function describeFrequency(unit: RecurrenceUnit, n: number, anchorDay: number): string {
  if (unit === "day") return n === 1 ? "Todo dia" : `A cada ${n} dias`;
  if (unit === "week") return n === 1 ? "Toda semana" : `A cada ${n} semanas`;
  if (unit === "month") return n === 1 ? `Todo mês, dia ${anchorDay}` : `A cada ${n} meses, dia ${anchorDay}`;
  return n === 1 ? "Todo ano" : `A cada ${n} anos`;
}
/** Versão curta, minúscula, para a linha "Manutenção · todo mês · próxima 12/12". */
export function describeShort(unit: RecurrenceUnit, n: number): string {
  if (unit === "day") return n === 1 ? "todo dia" : `a cada ${n} dias`;
  if (unit === "week") return n === 1 ? "toda semana" : `a cada ${n} semanas`;
  if (unit === "month") return n === 1 ? "todo mês" : `a cada ${n} meses`;
  return n === 1 ? "todo ano" : `a cada ${n} anos`;
}
export function fmtBR(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${pad(d)}/${pad(m)}/${y}`;
}
export function fmtBRShort(iso: string): string {
  const [, m, d] = parts(iso);
  return `${pad(d)}/${pad(m)}`;
}
