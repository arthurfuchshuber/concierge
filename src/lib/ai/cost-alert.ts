/**
 * AVISO DE GASTO ATÍPICO DA IA (31/10/2026) — só AVISA, nunca bloqueia nem limita nada.
 * Compara o gasto de hoje com a média dos dias anteriores (que tiveram gasto) e avisa quando passa
 * de `factor` vezes a média E de um piso em dólares (para não alarmar por centavos).
 */
export type CostSpike = { spike: boolean; todayUsd: number; baselineUsd: number; ratio: number };

export function detectCostSpike(
  todayUsd: number,
  previousDaysUsd: number[],
  opts: { factor?: number; minUsd?: number; minDays?: number } = {},
): CostSpike {
  const factor = opts.factor ?? 2;
  const minUsd = opts.minUsd ?? 1;
  const minDays = opts.minDays ?? 3;
  const days = previousDaysUsd.filter((v) => v > 0);
  const baseline = days.length ? days.reduce((s, v) => s + v, 0) / days.length : 0;
  const ratio = baseline > 0 ? todayUsd / baseline : 0;
  // Sem histórico suficiente não há "normal" para comparar: não avisa.
  const spike = days.length >= minDays && todayUsd >= minUsd && todayUsd > baseline * factor;
  return { spike, todayUsd: Number(todayUsd.toFixed(4)), baselineUsd: Number(baseline.toFixed(4)), ratio: Number(ratio.toFixed(2)) };
}

/** Dia (AAAA-MM-DD) no horário de Brasília, para "hoje" bater com o dia do anfitrião. */
export function dayKeyBR(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}
