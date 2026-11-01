/**
 * RELATÓRIO DE CUSTO DA IA (31/10/2026): cada resposta da IA já grava, em `ai_agent_logs`, o custo estimado
 * (tokens × tabela de preços de `models.ts`) somando TUDO o que a resposta gastou (intenção, memória, ferramentas,
 * validação, reflexão). Aqui só se AGREGA para leitura. Não existe nenhum limite ou bloqueio por custo:
 * é apenas registro e visibilidade.
 */
export type AiCostRow = {
  created_at: string;
  property_id: string | null;
  conversation_id: string | null;
  surface: string | null;
  channel_origin: string | null;
  cost_estimate: number | null;
  tokens: unknown;
  models: unknown;
};

export type AiCostBucket = { key: string; responses: number; costUsd: number; tokensIn: number; tokensOut: number };

export type AiCostReport = {
  responses: number;
  totalUsd: number;
  avgUsd: number;
  tokensIn: number;
  tokensOut: number;
  byDay: AiCostBucket[];
  byProperty: AiCostBucket[];
  byConversation: AiCostBucket[];
  byChannel: AiCostBucket[];
  byAgentModel: AiCostBucket[];
};

const round = (n: number) => Number(n.toFixed(6));

function add(map: Map<string, AiCostBucket>, key: string, cost: number, tin: number, tout: number) {
  const b = map.get(key) ?? { key, responses: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
  b.responses += 1;
  b.costUsd += cost;
  b.tokensIn += tin;
  b.tokensOut += tout;
  map.set(key, b);
}

const toList = (m: Map<string, AiCostBucket>, sort: "cost" | "key", limit?: number) => {
  const list = [...m.values()].map((b) => ({ ...b, costUsd: round(b.costUsd) }));
  list.sort(sort === "cost" ? (a, b) => b.costUsd - a.costUsd : (a, b) => a.key.localeCompare(b.key));
  return limit ? list.slice(0, limit) : list;
};

export function summarizeAiCosts(rows: AiCostRow[], topN = 20): AiCostReport {
  const day = new Map<string, AiCostBucket>();
  const prop = new Map<string, AiCostBucket>();
  const conv = new Map<string, AiCostBucket>();
  const chan = new Map<string, AiCostBucket>();
  const model = new Map<string, AiCostBucket>();
  let total = 0;
  let tin = 0;
  let tout = 0;
  for (const r of rows) {
    const cost = Number(r.cost_estimate ?? 0) || 0;
    const t = (r.tokens && typeof r.tokens === "object" ? r.tokens : {}) as { input?: number; output?: number };
    const i = Number(t.input ?? 0) || 0;
    const o = Number(t.output ?? 0) || 0;
    total += cost;
    tin += i;
    tout += o;
    add(day, r.created_at.slice(0, 10), cost, i, o);
    add(prop, r.property_id ?? "sem-imovel", cost, i, o);
    if (r.conversation_id) add(conv, r.conversation_id, cost, i, o);
    add(chan, r.channel_origin ?? r.surface ?? "desconhecido", cost, i, o);
    const m = (r.models && typeof r.models === "object" ? (r.models as Record<string, string>)["agent"] : null) ?? "desconhecido";
    add(model, m, cost, i, o);
  }
  return {
    responses: rows.length,
    totalUsd: round(total),
    avgUsd: rows.length ? round(total / rows.length) : 0,
    tokensIn: tin,
    tokensOut: tout,
    byDay: toList(day, "key"),
    byProperty: toList(prop, "cost"),
    byConversation: toList(conv, "cost", topN),
    byChannel: toList(chan, "cost"),
    byAgentModel: toList(model, "cost"),
  };
}
