/**
 * Período curto "2a8m" (pedido 13/10/2026, ficha do proprietário): anos e meses
 * completos entre o início e o fim da vigência (ou hoje). Só meses → "8m";
 * só anos → "2a"; menos de um mês → "<1m".
 */
export function periodShort(startISO: string, endISO?: string | null): string {
  const s = new Date(`${String(startISO).slice(0, 10)}T12:00:00`);
  const e = endISO ? new Date(`${String(endISO).slice(0, 10)}T12:00:00`) : new Date();
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  let months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  if (e.getDate() < s.getDate()) months -= 1;
  if (months < 1) return "<1m";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y > 0 ? `${y}a` : ""}${m > 0 ? `${m}m` : ""}`;
}
