/**
 * Motor Hybrid RAG — recuperação de informação SEM modelo de linguagem.
 * Combina busca vetorial (embeddings), busca textual (full text) e consultas
 * SQL estruturadas, com filtros por conta e por imóvel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedOne, EMPTY_USAGE, mergeUsage, type Usage } from "./gateway.server";
import { confidenceOf } from "./sources";

export type Passage = {
  id: string;
  source: string;
  title: string | null;
  content: string;
  confidence: number;
  score: number;
  retrieval: "vector" | "text" | "sql";
};

type Admin = SupabaseClient;

const MAX_PASSAGES = 12;

export async function hybridRetrieve(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  query: string;
  limit?: number;
}): Promise<{ passages: Passage[]; usage: Usage; retrievalUsed: string[] }> {
  const { supabase, ownerId, propertyId, query } = params;
  const limit = params.limit ?? MAX_PASSAGES;
  const retrievalUsed: string[] = [];
  let usage = EMPTY_USAGE;
  const byId = new Map<string, Passage>();

  // 1) Busca vetorial (semântica)
  try {
    const { vector, usage: embedUsage } = await embedOne(query);
    usage = mergeUsage(usage, embedUsage);
    if (vector?.length) {
      retrievalUsed.push("vector");
      const { data } = await supabase.rpc("match_ai_kb_chunks", {
        query_embedding: vector as unknown as string,
        _owner_id: ownerId,
        _property_id: propertyId,
        match_count: limit,
      });
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const source = String(row.source ?? "guide");
        const confidence = Number(row.confidence ?? confidenceOf(source));
        const similarity = Number(row.similarity ?? 0);
        byId.set(String(row.id), {
          id: String(row.id),
          source,
          title: (row.title as string) ?? null,
          content: String(row.content ?? ""),
          confidence,
          score: confidence * Math.max(similarity, 0),
          retrieval: "vector",
        });
      }
    }
  } catch (err) {
    console.error("[rag] busca vetorial falhou", err);
  }

  // 2) Busca textual (full text search)
  try {
    retrievalUsed.push("text");
    const { data } = await supabase.rpc("search_ai_kb_chunks_text", {
      _query: query,
      _owner_id: ownerId,
      _property_id: propertyId,
      match_count: limit,
    });
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(row.id);
      const source = String(row.source ?? "guide");
      const confidence = Number(row.confidence ?? confidenceOf(source));
      const rank = Math.min(Number(row.rank ?? 0) * 4, 1);
      const existing = byId.get(id);
      if (existing) {
        existing.score = Math.max(existing.score, confidence * rank) + 0.05; // reforço híbrido
      } else {
        byId.set(id, {
          id,
          source,
          title: (row.title as string) ?? null,
          content: String(row.content ?? ""),
          confidence,
          score: confidence * rank,
          retrieval: "text",
        });
      }
    }
  } catch (err) {
    console.error("[rag] busca textual falhou", err);
  }

  const passages = Array.from(byId.values())
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, limit);

  return { passages, usage, retrievalUsed };
}

/** Formata os trechos recuperados com a fonte e o score, para o agente interpretar. */
export function renderPassages(passages: Passage[]): string {
  if (!passages.length) return "(nenhum trecho recuperado)";
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] fonte=${p.source} confiabilidade=${Math.round(p.confidence * 100)}%` +
        `${p.title ? ` título="${p.title}"` : ""}\n${p.content}`,
    )
    .join("\n\n");
}
