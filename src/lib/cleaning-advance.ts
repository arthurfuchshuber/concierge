/**
 * Conclusão da limpeza (07/11/2026): a janela "Qual limpeza foi feita?" só
 * abre quando o imóvel tem os DOIS tipos cadastrados (normal e completa).
 * Com um só tipo, conclui direto nele; sem nenhum, conclui sem tipo — nada de
 * janela com um botão solitário.
 */
export type CleaningAdvanceDecision =
  | { ask: true }
  | { ask: false; cleaningType: "normal" | "completa" | undefined };

export function cleaningAdvanceDecision(row: {
  cleaningPriceNormalCents?: number | null;
  cleaningPriceFullCents?: number | null;
}): CleaningAdvanceDecision {
  const hasNormal = (row.cleaningPriceNormalCents ?? 0) > 0;
  const hasCompleta = (row.cleaningPriceFullCents ?? 0) > 0;
  if (hasNormal && hasCompleta) return { ask: true };
  return { ask: false, cleaningType: hasNormal ? "normal" : hasCompleta ? "completa" : undefined };
}
