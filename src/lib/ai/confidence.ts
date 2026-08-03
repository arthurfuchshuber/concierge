/**
 * Confidence Threshold — níveis de confiança configuráveis.
 *
 * A confiança final combina: validação anti-alucinação, autoavaliação
 * (reflection), peso das fontes consultadas e risco do plano. O nível
 * resultante decide entre responder direto, responder com ressalva ou
 * escalar obrigatoriamente para humano.
 */

export type ConfidenceTier = "auto" | "hedged" | "handoff";

export type ConfidenceThresholds = {
  /** >= auto: responde automaticamente. */
  auto: number;
  /** >= hedged (e < auto): responde com ressalva. Abaixo disso: handoff. */
  hedged: number;
};

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { auto: 0.75, hedged: 0.55 };

/** Modo exploração é conversacional: tolera confiança menor e nunca escala sozinho. */
export const EXPLORATION_THRESHOLDS: ConfidenceThresholds = { auto: 0.5, hedged: 0.2 };

/** Temas sensíveis exigem confiança mais alta. */
export const STRICT_THRESHOLDS: ConfidenceThresholds = { auto: 0.85, hedged: 0.7 };

export function thresholdsFor(params: {
  explorationMode?: boolean;
  category?: string;
  urgency?: string;
}): ConfidenceThresholds {
  if (params.explorationMode) return EXPLORATION_THRESHOLDS;
  if (params.urgency === "high") return STRICT_THRESHOLDS;
  if (params.category === "acesso" || params.category === "reserva" || params.category === "financeiro") {
    return STRICT_THRESHOLDS;
  }
  return DEFAULT_THRESHOLDS;
}

export function tierFor(confidence: number, t: ConfidenceThresholds): ConfidenceTier {
  if (confidence >= t.auto) return "auto";
  if (confidence >= t.hedged) return "hedged";
  return "handoff";
}

/**
 * Score final ponderado.
 * - validação anti-alucinação: 45%
 * - autoavaliação (reflection): 30%
 * - peso médio das fontes efetivamente usadas: 25%
 * Penalidades: sem nenhuma fonte, ou risco alto no plano.
 */
export function aggregateConfidence(params: {
  validation: number | null;
  reflection: number | null;
  sourceWeight: number | null;
  riskLevel?: "low" | "normal" | "high";
}): number {
  const parts: Array<{ value: number; weight: number }> = [];
  if (params.validation !== null) parts.push({ value: params.validation, weight: 0.45 });
  if (params.reflection !== null) parts.push({ value: params.reflection, weight: 0.3 });
  if (params.sourceWeight !== null) parts.push({ value: params.sourceWeight, weight: 0.25 });
  if (!parts.length) return 0.5;

  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  let score = parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;

  if (params.sourceWeight === null) score -= 0.1;
  if (params.riskLevel === "high") score -= 0.05;

  return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/** Ressalva adicionada quando a confiança fica na faixa intermediária. */
export function hedgeNotice(language: string): string {
  const pt = "\n\n_Confirme comigo ou com o anfitrião antes de contar com essa informação — quero ter certeza de que está tudo certo para você._";
  const en = "\n\n_Please double-check this with me or your host — I want to make sure everything is right for you._";
  const es = "\n\n_Confírmalo conmigo o con el anfitrión — quiero asegurarme de que todo esté correcto._";
  if (language?.startsWith("en")) return en;
  if (language?.startsWith("es")) return es;
  return pt;
}
