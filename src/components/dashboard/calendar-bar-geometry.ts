/**
 * Geometria da ETIQUETA (nome + valor) da barra de reserva do calendário (31/10/2026).
 * A barra visual vai do MEIO do dia de check-in ao MEIO do dia de checkout: largura real = noites × dayW.
 * A etiqueta nasce na célula do check-in, deslocada meio dia, e cobre toda a extensão visível
 * (recortada quando a reserva começa antes / termina depois da janela exibida).
 */
export function barLabelGeometry(p: {
  checkinIndex: number | undefined; // índice do dia de check-in na janela (undefined = fora)
  checkoutIndex: number | undefined; // índice do dia de checkout na janela (undefined = fora)
  startsBefore: boolean;
  endsAfter: boolean;
  dayCount: number;
  dayW: number;
}): { cell: number; left: number; width: number } {
  const { checkinIndex, checkoutIndex, startsBefore, endsAfter, dayCount, dayW } = p;
  const cell = startsBefore ? 0 : checkinIndex ?? 0;
  const startX = startsBefore ? 0 : cell * dayW + dayW / 2;
  const endX = endsAfter ? dayCount * dayW : (checkoutIndex ?? 0) * dayW + dayW / 2;
  return { cell, left: startsBefore ? 0 : dayW / 2, width: endX - startX };
}
