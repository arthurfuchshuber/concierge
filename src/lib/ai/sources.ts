/**
 * Ranking Permanente de Fontes.
 *
 * Pesos fixos e auditáveis por fonte. Em caso de conflito entre informações,
 * a fonte de maior peso SEMPRE prevalece — e fontes conflitantes nunca são
 * misturadas na mesma resposta.
 *
 * Alterar um peso aqui muda o comportamento de todo o agente: mantenha a
 * ordem hierárquica (oficial > curado > externo > inferido).
 */
export const SOURCE_CONFIDENCE: Record<string, number> = {
  // Tier 1 — dados oficiais e transacionais
  reservation: 1.0,
  database: 0.99,
  property: 0.99,
  // Tier 2 — conteúdo oficial publicado pelo anfitrião
  guide: 0.98,
  manual: 0.98,
  faq: 0.98,
  rules: 0.98,
  checkout: 0.98,
  procedures: 0.97,
  host_knowledge: 0.97,
  host_behavior: 0.97,
  // Tier 3 — APIs externas confiáveis
  calendar: 0.95,
  weather: 0.95,
  maps: 0.94,
  recommendation: 0.94,
  city_reference: 0.9,
  // Tier 4 — inferido / histórico
  guest_memory: 0.75,
  conversation: 0.7,
};

export const SOURCE_TIERS: Array<{ tier: number; label: string; sources: string[] }> = [
  { tier: 1, label: "Oficial transacional", sources: ["reservation", "database", "property"] },
  {
    tier: 2,
    label: "Conteúdo oficial do anfitrião",
    sources: ["guide", "manual", "faq", "rules", "checkout", "procedures", "host_knowledge", "host_behavior"],
  },
  { tier: 3, label: "APIs externas e curadoria", sources: ["calendar", "weather", "maps", "recommendation", "city_reference"] },
  { tier: 4, label: "Inferido / histórico", sources: ["guest_memory", "conversation"] },
];

export const DEFAULT_CONFIDENCE = 0.6;

export function confidenceOf(source: string): number {
  return SOURCE_CONFIDENCE[source] ?? DEFAULT_CONFIDENCE;
}

export function tierOf(source: string): number {
  const found = SOURCE_TIERS.find((t) => t.sources.includes(source));
  return found?.tier ?? 5;
}

/** Ordena fontes da mais confiável para a menos confiável. */
export function rankSources<T extends { source: string; confidence?: number }>(items: T[]): T[] {
  return items
    .slice()
    .sort((a, b) => (b.confidence ?? confidenceOf(b.source)) - (a.confidence ?? confidenceOf(a.source)));
}

/**
 * Peso médio ponderado das fontes efetivamente usadas — insumo do
 * Confidence Threshold. Retorna null quando nenhuma fonte foi consultada.
 */
export function aggregateSourceWeight(items: Array<{ source: string; confidence?: number }>): number | null {
  if (!items.length) return null;
  const ranked = rankSources(items).slice(0, 8);
  // A fonte mais forte domina; as demais reforçam com peso decrescente.
  let total = 0;
  let weight = 0;
  ranked.forEach((item, i) => {
    const w = 1 / (i + 1);
    total += (item.confidence ?? confidenceOf(item.source)) * w;
    weight += w;
  });
  return Number((total / weight).toFixed(4));
}

/** Texto do ranking, injetado no prompt do agente para resolução de conflitos. */
export function renderSourceRanking(): string {
  return SOURCE_TIERS.map(
    (t) =>
      `Tier ${t.tier} (${t.label}): ${t.sources
        .map((s) => `${s}=${Math.round(confidenceOf(s) * 100)}%`)
        .join(", ")}`,
  ).join("\n");
}
