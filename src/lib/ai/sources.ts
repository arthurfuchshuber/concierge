/**
 * Ranking de confiabilidade das fontes de informação.
 * Em caso de conflito, a fonte de maior score sempre prevalece — e fontes
 * conflitantes nunca são misturadas na mesma resposta.
 */
export const SOURCE_CONFIDENCE: Record<string, number> = {
  reservation: 1.0,
  database: 0.99,
  property: 0.99,
  guide: 0.98,
  manual: 0.98,
  faq: 0.98,
  rules: 0.98,
  checkout: 0.98,
  procedures: 0.97,
  host_knowledge: 0.97,
  host_behavior: 0.97,
  calendar: 0.95,
  weather: 0.95,
  maps: 0.94,
  recommendation: 0.94,
  city_reference: 0.9,
  guest_memory: 0.75,
  conversation: 0.7,
};

export function confidenceOf(source: string): number {
  return SOURCE_CONFIDENCE[source] ?? 0.6;
}
