/**
 * Agent Quality Score.
 *
 * Score final = média ponderada de cinco dimensões (0..1):
 *   Accuracy · Confidence · Reflection · Human Approval · Resolution Rate
 */

export type QualityInput = {
  /** Aderência ao comportamento esperado (agente/ferramentas/fontes/handoff). */
  accuracy: number;
  confidence: number;
  reflection: number;
  humanApproval: number;
  resolutionRate: number;
};

export const QUALITY_WEIGHTS: Record<keyof QualityInput, number> = {
  accuracy: 0.35,
  confidence: 0.2,
  reflection: 0.15,
  humanApproval: 0.15,
  resolutionRate: 0.15,
};

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function agentQualityScore(input: Partial<QualityInput>): number {
  let total = 0;
  let weight = 0;
  for (const key of Object.keys(QUALITY_WEIGHTS) as Array<keyof QualityInput>) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    total += clamp01(value) * QUALITY_WEIGHTS[key];
    weight += QUALITY_WEIGHTS[key];
  }
  return weight === 0 ? 0 : Number((total / weight).toFixed(4));
}

/** Aderência do resultado real ao cenário esperado. */
export function accuracyScore(params: {
  expectedAgent: string;
  actualAgent: string;
  expectedTools: string[];
  actualTools: string[];
  expectedSources: string[];
  actualSources: string[];
  expectHandoff: boolean;
  actualHandoff: boolean;
}): { score: number; breakdown: Record<string, number> } {
  const agent = params.expectedAgent === params.actualAgent ? 1 : 0;
  const handoff = params.expectHandoff === params.actualHandoff ? 1 : 0;
  const tools = coverage(params.expectedTools, params.actualTools);
  const sources = coverage(params.expectedSources, params.actualSources);
  const score = Number((agent * 0.4 + handoff * 0.25 + tools * 0.2 + sources * 0.15).toFixed(4));
  return { score, breakdown: { agent, handoff, tools, sources } };
}

/** Fração das expectativas atendidas (sem punir extras úteis). */
function coverage(expected: string[], actual: string[]): number {
  if (!expected.length) return 1;
  const set = new Set(actual.map((s) => s.toLowerCase()));
  const hits = expected.filter((e) => set.has(e.toLowerCase())).length;
  return Number((hits / expected.length).toFixed(4));
}

export function statusFor(score: number): "passed" | "warning" | "failed" {
  if (score >= 0.8) return "passed";
  if (score >= 0.6) return "warning";
  return "failed";
}
