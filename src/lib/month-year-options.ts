/**
 * Regras puras do SELETOR RÁPIDO DE MÊS E ANO dos calendários (29/10/2026, mockups
 * "Seletor de mês e ano nos calendários").
 *
 * Regra do pedido: a lista só mostra opções com possibilidade de ação ou dados
 * reais. Cada calendário informa o primeiro e o último mês navegáveis (`min`/`max`);
 * aqui sai o que aparece nas duas colunas:
 *   · ANO  → só anos que têm pelo menos um mês navegável;
 *   · MÊS  → só meses navegáveis DENTRO do ano escolhido (com 2026 escolhido e
 *            "hoje" em outubro, janeiro a setembro nem aparecem).
 *
 * Um mês é representado pelo índice `ano * 12 + mês (0–11)`.
 */

export const monthIdx = (d: Date): number => d.getFullYear() * 12 + d.getMonth();

export type MonthBounds = { lo: number; hi: number };

/** Anos de folga quando o calendário não informa limites (datas livres). */
const FREE_YEARS_BACK = 5;
const FREE_YEARS_AHEAD = 3;

/**
 * Primeiro/último mês navegáveis. Sem `min`/`max` (calendário livre) usa uma janela
 * em volta de hoje; o mês que está na tela entra sempre, para a lista nunca "perder"
 * a seleção atual.
 */
export function monthBounds(shown: Date, min?: Date | null, max?: Date | null, today: Date = new Date()): MonthBounds {
  const cur = monthIdx(shown);
  const lo = min ? monthIdx(min) : (today.getFullYear() - FREE_YEARS_BACK) * 12;
  const hi = max ? monthIdx(max) : (today.getFullYear() + FREE_YEARS_AHEAD) * 12 + 11;
  return { lo: Math.min(lo, cur), hi: Math.max(hi, cur) };
}

/** Anos que aparecem na coluna "Ano" (crescente). */
export function yearOptions({ lo, hi }: MonthBounds): number[] {
  const out: number[] = [];
  for (let y = Math.floor(lo / 12); y <= Math.floor(hi / 12); y++) out.push(y);
  return out;
}

/** Meses (0–11) que aparecem na coluna "Mês" para o ano escolhido. */
export function monthOptions(year: number, { lo, hi }: MonthBounds): number[] {
  const out: number[] = [];
  for (let m = 0; m < 12; m++) {
    const idx = year * 12 + m;
    if (idx >= lo && idx <= hi) out.push(m);
  }
  return out;
}

/** Ao trocar de ano, mantém o mês quando existe; senão, o mais próximo que existe. */
export function clampMonthInYear(year: number, month: number, bounds: MonthBounds): number {
  const opts = monthOptions(year, bounds);
  if (!opts.length) return month;
  if (opts.includes(month)) return month;
  return month < opts[0] ? opts[0] : opts[opts.length - 1];
}
