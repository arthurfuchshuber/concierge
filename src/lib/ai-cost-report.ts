/**
 * RELATÓRIO DE CUSTO DA IA: lê o livro-caixa `ai_usage_events` (uma linha por chamada paga ao gateway —
 * chat, agente, embeddings, tradução…), que cobre TODO o gasto. Aqui só se AGREGA para leitura.
 * Não existe nenhum limite ou bloqueio por custo: é apenas registro e visibilidade.
 */
export type AiUsageEventRow = {
  created_at: string;
  task: string;
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | string | null;
  owner_id: string | null;
  property_id: string | null;
  conversation_id: string | null;
  surface: string | null;
};

export type AiCostBucket = { key: string; calls: number; costUsd: number; tokensIn: number; tokensOut: number };

export type AiCostReport = {
  /** Chamadas pagas ao gateway (uma resposta pode ter várias). */
  calls: number;
  totalUsd: number;
  tokensIn: number;
  tokensOut: number;
  /** Conversas distintas com gasto no período e o custo médio por conversa. */
  conversations: number;
  avgPerConversationUsd: number;
  byDay: AiCostBucket[];
  byProperty: AiCostBucket[];
  byConversation: AiCostBucket[];
  bySurface: AiCostBucket[];
  byTask: AiCostBucket[];
  byModel: AiCostBucket[];
};

const round = (n: number) => Number(n.toFixed(6));

function add(map: Map<string, AiCostBucket>, key: string, cost: number, tin: number, tout: number) {
  const b = map.get(key) ?? { key, calls: 0, costUsd: 0, tokensIn: 0, tokensOut: 0 };
  b.calls += 1;
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

export function summarizeAiCosts(rows: AiUsageEventRow[], topN = 20): AiCostReport {
  const day = new Map<string, AiCostBucket>();
  const prop = new Map<string, AiCostBucket>();
  const conv = new Map<string, AiCostBucket>();
  const surf = new Map<string, AiCostBucket>();
  const task = new Map<string, AiCostBucket>();
  const model = new Map<string, AiCostBucket>();
  let total = 0;
  let tin = 0;
  let tout = 0;
  for (const r of rows) {
    const cost = Number(r.cost_usd ?? 0) || 0;
    const i = Number(r.tokens_in ?? 0) || 0;
    const o = Number(r.tokens_out ?? 0) || 0;
    total += cost;
    tin += i;
    tout += o;
    add(day, r.created_at.slice(0, 10), cost, i, o);
    add(prop, r.property_id ?? "sem-imovel", cost, i, o);
    if (r.conversation_id) add(conv, r.conversation_id, cost, i, o);
    add(surf, r.surface ?? "sem-origem", cost, i, o);
    add(task, r.task || "desconhecido", cost, i, o);
    add(model, r.model || "desconhecido", cost, i, o);
  }
  const conversations = conv.size;
  const convCost = [...conv.values()].reduce((s, b) => s + b.costUsd, 0);
  return {
    calls: rows.length,
    totalUsd: round(total),
    tokensIn: tin,
    tokensOut: tout,
    conversations,
    avgPerConversationUsd: conversations ? round(convCost / conversations) : 0,
    byDay: toList(day, "key"),
    byProperty: toList(prop, "cost"),
    byConversation: toList(conv, "cost", topN),
    bySurface: toList(surf, "cost"),
    byTask: toList(task, "cost"),
    byModel: toList(model, "cost"),
  };
}
