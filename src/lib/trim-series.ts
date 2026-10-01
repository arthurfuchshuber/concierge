/**
 * REGRA DE TODOS OS DASHBOARDS: gráficos por dia mostram só do primeiro ao
 * último dia COM dado dentro do período filtrado. Sem nenhum dado, devolve
 * a série inteira (o gráfico mostra o vazio do período).
 */
export function trimSeries<T>(data: T[] | null | undefined, hasData: (p: T) => boolean): T[] {
  if (!data || data.length === 0) return data ?? [];
  let first = -1;
  let last = -1;
  for (let i = 0; i < data.length; i += 1) {
    if (hasData(data[i])) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return data;
  return data.slice(first, last + 1);
}
