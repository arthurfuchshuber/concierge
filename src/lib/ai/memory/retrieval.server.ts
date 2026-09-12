/**
 * Memory Retrieval System — recuperação inteligente e pontuada de memórias.
 *
 * Nunca carrega o histórico inteiro. Recupera candidatas por similaridade
 * semântica (pgvector) + busca textual, e as pontua por:
 *
 *   Tier  1  contexto da reserva atual (mesmo hóspede, mesma estadia)
 *   Tier  2  problemas recentes do mesmo imóvel
 *   Tier  3  preferências do hóspede
 *   Tier  4  histórico antigo relevante
 *   Tier  5  memórias genéricas
 *
 * Fatores adicionais: relevância semântica, decaimento temporal, confiança da
 * origem, importância e relação com a categoria da solicitação.
 *
 * REGRA DE OURO: memória NUNCA é verdade absoluta. Toda memória entregue ao
 * agente vem carimbada com origem, data e confiança, e é explicitamente
 * subordinada às fontes oficiais no Ranking Permanente de Fontes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedOne, EMPTY_USAGE, mergeUsage, type Usage } from "../gateway.server";
import { rowToRecord } from "./longterm.server";
import type { MemoryRecord, ScoredMemory } from "./types";

type Admin = SupabaseClient;

/** Meia-vida do decaimento, em dias, por natureza da memória. */
const HALF_LIFE_DAYS: Record<string, number> = {
  preference: 365,
  property_fact: 540,
  resolution: 240,
  operational_decision: 240,
  issue: 120,
  fact: 180,
};

/** Confiança abaixo disso a memória é descartada antes de chegar ao agente. */
const MIN_CONFIDENCE = 0.35;
/** Score final mínimo para entrar no contexto. */
const MIN_SCORE = 0.18;

export function decayFactor(lastSeenAt: string, kind: string): number {
  const ts = Date.parse(lastSeenAt);
  if (!Number.isFinite(ts)) return 0.5;
  const days = Math.max(0, (Date.now() - ts) / 86400000);
  const halfLife = HALF_LIFE_DAYS[kind] ?? 180;
  return Math.pow(0.5, days / halfLife);
}

function tierOf(
  memory: MemoryRecord,
  ctx: { subjectKey: string | null; propertyId: string | null; category: string | null },
): 1 | 2 | 3 | 4 | 5 {
  const sameGuest = !!ctx.subjectKey && memory.subjectKey === ctx.subjectKey;
  const sameProperty = !!ctx.propertyId && memory.propertyId === ctx.propertyId;
  const recentDays = (Date.now() - Date.parse(memory.lastSeenAt)) / 86400000;

  if (sameGuest && (memory.kind === "issue" || memory.kind === "resolution") && recentDays <= 30) return 1;
  if (sameGuest && memory.kind === "operational_decision" && recentDays <= 30) return 1;
  if (sameProperty && (memory.kind === "issue" || memory.kind === "resolution") && recentDays <= 120) return 2;
  if (sameGuest && memory.kind === "preference") return 3;
  if (memory.kind === "property_fact" && sameProperty) return 3;
  if (sameGuest || sameProperty) return 4;
  return 5;
}

const TIER_WEIGHT: Record<number, number> = { 1: 1, 2: 0.85, 3: 0.72, 4: 0.55, 5: 0.35 };

/**
 * Validação anti-memória-incorreta: origem conhecida, data plausível,
 * confiança mínima e relação com o contexto atual.
 */
function isTrustworthy(memory: MemoryRecord, ctx: { propertyId: string | null }): boolean {
  if (!memory.content?.trim()) return false;
  if (memory.confidence < MIN_CONFIDENCE) return false;
  if (!memory.source) return false;
  const ts = Date.parse(memory.lastSeenAt);
  if (!Number.isFinite(ts) || ts > Date.now() + 86400000) return false;
  // memória de outro imóvel só é aceita quando não é específica de imóvel
  if (memory.propertyId && ctx.propertyId && memory.propertyId !== ctx.propertyId) return false;
  return true;
}

export async function retrieveMemories(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  subjectKey: string | null;
  query: string;
  category?: string | null;
  limit?: number;
}): Promise<{ memories: ScoredMemory[]; usage: Usage; retrievalUsed: string[]; confidence: number }> {
  const { supabase } = params;
  const limit = params.limit ?? 8;
  const retrievalUsed: string[] = [];
  let usage = EMPTY_USAGE;
  const byId = new Map<string, ScoredMemory>();
  const ctx = {
    subjectKey: params.subjectKey,
    propertyId: params.propertyId,
    category: params.category ?? null,
  };

  const push = (record: MemoryRecord, relevance: number, retrieval: "vector" | "text") => {
    if (!isTrustworthy(record, ctx)) return;
    const tier = tierOf(record, ctx);
    const decay = decayFactor(record.lastSeenAt, record.kind);
    const categoryBoost = ctx.category && record.category === ctx.category ? 1.15 : 1;
    const score =
      TIER_WEIGHT[tier] *
      (0.35 + 0.65 * Math.max(relevance, 0)) *
      (0.4 + 0.6 * decay) *
      record.confidence *
      (0.6 + 0.4 * record.importance) *
      categoryBoost;

    const existing = byId.get(record.id);
    if (existing) {
      existing.score = Math.max(existing.score, score) + 0.03; // reforço híbrido
      existing.relevance = Math.max(existing.relevance, relevance);
      return;
    }
    byId.set(record.id, { ...record, tier, relevance, decay, score, retrieval });
  };

  // 1) Semântica
  try {
    const { vector, usage: embedUsage } = await embedOne(params.query);
    usage = mergeUsage(usage, embedUsage);
    if (vector?.length) {
      retrievalUsed.push("vector");
      const { data } = await supabase.rpc("match_ai_memories", {
        query_embedding: vector as unknown as string,
        _owner_id: params.ownerId,
        _property_id: params.propertyId,
        _subject_key: params.subjectKey,
        match_count: limit * 2,
      });
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        push(rowToRecord(row), Number(row.similarity ?? 0), "vector");
      }
    }
  } catch (err) {
    console.error("[memory-retrieval] busca vetorial falhou", err);
  }

  // 2) Textual
  try {
    retrievalUsed.push("text");
    const { data } = await supabase.rpc("search_ai_memories_text", {
      _query: params.query,
      _owner_id: params.ownerId,
      _property_id: params.propertyId,
      _subject_key: params.subjectKey,
      match_count: limit * 2,
    });
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      push(rowToRecord(row), Math.min(Number(row.rank ?? 0) * 4, 1), "text");
    }
  } catch (err) {
    console.error("[memory-retrieval] busca textual falhou", err);
  }

  const memories = Array.from(byId.values())
    .filter((m) => m.score >= MIN_SCORE)
    .sort((a, b) => a.tier - b.tier || b.score - a.score)
    .slice(0, limit);

  const confidence = memories.length
    ? memories.reduce((acc, m) => acc + m.confidence * m.decay, 0) / memories.length
    : 0;

  return { memories, usage, retrievalUsed, confidence: Number(confidence.toFixed(4)) };
}

function ageLabel(lastSeenAt: string): string {
  const days = Math.floor((Date.now() - Date.parse(lastSeenAt)) / 86400000);
  if (!Number.isFinite(days)) return "data desconhecida";
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  if (days < 365) return `há ${Math.round(days / 30)} meses`;
  return `há ${Math.round(days / 365)} anos`;
}

/** Renderiza as memórias com origem, data e confiança — nunca como fato absoluto. */
export function renderMemories(memories: ScoredMemory[]): string {
  if (!memories.length) return "(nenhuma memória relevante)";
  return memories
    .map(
      (m, i) =>
        `[M${i + 1}] tier=${m.tier} tipo=${m.kind} origem=${m.source} registrada ${ageLabel(m.lastSeenAt)} ` +
        `confiança=${Math.round(m.confidence * m.decay * 100)}%` +
        `${m.title ? ` título="${m.title}"` : ""}\n${m.content}`,
    )
    .join("\n\n");
}
