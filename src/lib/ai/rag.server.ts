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

/** Teto por consulta ao banco: uma consulta lenta nunca pode travar a resposta ao hóspede. */
export const RAG_DB_DEADLINE_MS = 8_000;

/** Resolve com `null` se a consulta ao banco passar do prazo (só banco, nunca chamadas de modelo). */
export async function withDbDeadline<T>(work: PromiseLike<T>, ms = RAG_DB_DEADLINE_MS): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([Promise.resolve(work), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * PÚBLICO DO TRECHO (01/11/2026): G = Reserva Ativa (só com reserva ativa) · P = Público (qualquer pessoa) ·
 * I = Equipe Interna (nunca vai ao hóspede). Regra pura, testada.
 */
export function audienceAllowed(audience: string | null | undefined, activeReservation: boolean): boolean {
  if (audience === "I") return false;
  if (audience === "G") return activeReservation;
  return true; // P, vazio ou desconhecido = comportamento de sempre
}

/**
 * Dos ids encontrados, devolve os que a pessoa pode receber. Se a coluna `audience` ainda não existir no
 * banco (migração pendente), nada é filtrado — comportamento anterior.
 */
export async function allowedChunkIds(supabase: Admin, ids: string[], activeReservation: boolean): Promise<Set<string>> {
  if (!ids.length) return new Set();
  try {
    const { data, error } = await supabase.from("ai_kb_chunks").select("id, audience").in("id", ids);
    if (error || !Array.isArray(data)) return new Set(ids);
    const aud = new Map((data as Array<{ id: string; audience?: string | null }>).map((r) => [r.id, r.audience ?? "P"]));
    return new Set(ids.filter((id) => audienceAllowed(aud.get(id), activeReservation)));
  } catch {
    return new Set(ids);
  }
}

export async function hybridRetrieve(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  query: string;
  limit?: number;
  /** O hóspede tem reserva confirmada e ativa? Sem isso, trechos de "Reserva Ativa" não são devolvidos. */
  activeReservation?: boolean;
}): Promise<{ passages: Passage[]; usage: Usage; retrievalUsed: string[] }> {
  const { supabase, ownerId, propertyId, query } = params;
  const limit = params.limit ?? MAX_PASSAGES;
  const activeReservation = params.activeReservation === true;
  // Busca um pouco a mais: o filtro de público pode descartar trechos.
  const fetchCount = limit * 2;
  const retrievalUsed: string[] = [];
  let usage = EMPTY_USAGE;
  const byId = new Map<string, Passage>();

  // 1) Busca vetorial (semântica)
  try {
    const { vector, usage: embedUsage } = await embedOne(query);
    usage = mergeUsage(usage, embedUsage);
    if (vector?.length) {
      retrievalUsed.push("vector");
      const res = await withDbDeadline(
        supabase.rpc("match_ai_kb_chunks", {
          query_embedding: vector as unknown as string,
          _owner_id: ownerId,
          _property_id: propertyId,
          match_count: fetchCount,
        }),
      );
      if (!res) console.warn("[rag] busca vetorial passou do prazo — seguindo sem ela");
      const data = res?.data;
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
    const res = await withDbDeadline(
      supabase.rpc("search_ai_kb_chunks_text", {
        _query: query,
        _owner_id: ownerId,
        _property_id: propertyId,
        match_count: fetchCount,
      }),
    );
    if (!res) console.warn("[rag] busca textual passou do prazo — seguindo sem ela");
    const data = res?.data;
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

  // Piso de relevância: um trecho fracamente parecido com a pergunta entrava no
  // prompt com "confiabilidade=97%" e o modelo o tratava como fato do momento
  // (ex.: template de pedido de avaliação puxado por um simples "boa tarde").
  const MIN_SCORE = 0.25;
  // Público: Equipe Interna nunca; Reserva Ativa só com reserva ativa.
  const allowed = await allowedChunkIds(supabase, Array.from(byId.keys()), activeReservation);
  for (const id of Array.from(byId.keys())) if (!allowed.has(id)) byId.delete(id);
  const all = Array.from(byId.values()).sort(
    (a, b) => b.score - a.score || b.confidence - a.confidence,
  );
  const relevant = all.filter((p) => p.score >= MIN_SCORE);
  const passages = (relevant.length ? relevant : all.slice(0, 3)).slice(0, limit);

  return { passages, usage, retrievalUsed };
}

/** Fontes que guardam REGRAS CONDICIONAIS ensinadas pelo anfitrião ("quando o hóspede disser X, faça Y"). */
const CONDITIONAL_SOURCES = new Set(["host_knowledge", "host_behavior", "tenant_knowledge"]);

/** Formata os trechos recuperados com a fonte e a relevância, para o agente interpretar. */
export function renderPassages(passages: Passage[]): string {
  if (!passages.length) return "(nenhum trecho recuperado)";
  const header =
    "ATENÇÃO: os trechos abaixo são apenas CANDIDATOS encontrados por busca. Eles NÃO descrevem " +
    "o que está acontecendo nesta conversa e NÃO são prova de que o hóspede disse, sentiu ou fez " +
    "algo. Use um trecho só se ele responder de fato à mensagem atual.\n\n";
  return (
    header +
    passages
      .map((p, i) => {
        const conditional = CONDITIONAL_SOURCES.has(p.source)
          ? " (REGRA CONDICIONAL: só vale se a situação descrita estiver acontecendo AGORA, na mensagem atual do hóspede)"
          : "";
        return (
          `[${i + 1}] fonte=${p.source} confiabilidade_da_fonte=${Math.round(p.confidence * 100)}%` +
          ` relevância_para_esta_mensagem=${Math.round(Math.min(p.score, 1) * 100)}%${conditional}` +
          `${p.title ? ` título="${p.title}"` : ""}\n${p.content}`
        );
      })
      .join("\n\n")
  );
}
