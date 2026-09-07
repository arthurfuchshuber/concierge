/**
 * Conhecimento do Assistente do Painel sobre o próprio sistema (07/09/2026).
 *
 * Dois lados:
 *
 *   `reindexSystemKnowledge` — sobe o que o extrator gerou no build
 *   (`src/generated/system-knowledge.json`) para `ai_system_docs`. Compara
 *   `content_hash` antes de gastar embedding: numa entrega que mexe em três
 *   arquivos, só esses três trechos são reprocessados. É o que torna barato
 *   rodar isso a cada deploy — e é rodar a cada deploy que faz o assistente
 *   conhecer as novidades sem ninguém escrever documentação.
 *
 *   `retrieveSystemKnowledge` — busca híbrida (vetorial + textual) sobre esse
 *   material. Mesmo desenho do `rag.server.ts` que serve o agente do hóspede,
 *   com uma diferença: aqui não há filtro por conta, porque o conhecimento do
 *   produto é o mesmo para todo mundo. Por isso ele mora numa tabela separada:
 *   se estivesse junto do conteúdo dos anfitriões, um bug de filtro exporia
 *   documentação interna numa conversa com hóspede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedOne, embedTexts, EMPTY_USAGE, mergeUsage, type Usage } from "./gateway.server";

export type SystemDoc = {
  docKey: string;
  kind: "route" | "rule" | "guide";
  title: string;
  content: string;
  sourcePath: string | null;
  score: number;
  retrieval: "vector" | "text";
};

type AnyClient = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

/**
 * Um trecho escrito à mão vale mais que um extraído do código, e uma regra de
 * negócio vale mais que a descrição de uma tela: quem pergunta "por quê"
 * quer o racional, não o rótulo do menu.
 */
const KIND_WEIGHT: Record<string, number> = { guide: 1.0, rule: 0.95, route: 0.85 };

// ───────────────────────────── indexação ─────────────────────────────

/** Quantos textos vão por chamada de embedding — o gateway aceita lotes. */
const EMBED_BATCH = 32;

export async function reindexSystemKnowledge(
  supabase: SupabaseClient,
): Promise<{ total: number; updated: number; removed: number; usage: Usage }> {
  const db = supabase as unknown as AnyClient;
  const { SYSTEM_KNOWLEDGE } = await import("@/generated/system-knowledge");
  const docs = SYSTEM_KNOWLEDGE;
  if (!docs.length) return { total: 0, updated: 0, removed: 0, usage: EMPTY_USAGE };

  const { data: existing } = await db.from("ai_system_docs").select("doc_key, content_hash");
  const known = new Map<string, string>();
  for (const row of (existing ?? []) as Array<{ doc_key: string; content_hash: string }>) {
    known.set(row.doc_key, row.content_hash);
  }

  const stale = docs.filter((d) => known.get(d.doc_key) !== d.content_hash);
  let usage = EMPTY_USAGE;
  let updated = 0;

  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH);
    // O título entra no texto do embedding: "Regra — defaultShowInCleaning"
    // carrega sinal que o corpo do comentário sozinho não tem.
    const { vectors, usage: u } = await embedTexts(batch.map((d) => `${d.title}\n\n${d.content}`));
    usage = mergeUsage(usage, u);
    const rows = batch.map((d, idx) => ({
      doc_key: d.doc_key,
      kind: d.kind,
      title: d.title,
      content: d.content,
      source_path: d.source_path,
      audience: d.audience ?? [],
      content_hash: d.content_hash,
      embedding: (vectors[idx] ?? null) as unknown as string | null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await db.from("ai_system_docs").upsert(rows, { onConflict: "doc_key" });
    if (error) throw new Error(error.message);
    updated += rows.length;
  }

  // Trecho que sumiu do código (regra removida, tela apagada) sai da base —
  // senão o assistente continuaria ensinando a usar algo que não existe mais.
  const liveKeys = new Set(docs.map((d) => d.doc_key));
  const orphans = Array.from(known.keys()).filter((k) => !liveKeys.has(k));
  if (orphans.length) {
    await db.from("ai_system_docs").delete().in("doc_key", orphans);
  }

  return { total: docs.length, updated, removed: orphans.length, usage };
}

// ───────────────────────────── recuperação ─────────────────────────────

export async function retrieveSystemKnowledge(params: {
  supabase: SupabaseClient;
  query: string;
  limit?: number;
}): Promise<{ docs: SystemDoc[]; usage: Usage }> {
  const db = params.supabase as unknown as AnyClient;
  const limit = params.limit ?? 8;
  const byKey = new Map<string, SystemDoc>();
  let usage = EMPTY_USAGE;

  type Row = {
    doc_key: string;
    kind: string;
    title: string;
    content: string;
    source_path: string | null;
    similarity?: number;
    rank?: number;
  };

  const take = (row: Row, raw: number, retrieval: "vector" | "text") => {
    const score = (KIND_WEIGHT[row.kind] ?? 0.85) * Math.max(raw, 0);
    const prev = byKey.get(row.doc_key);
    if (prev) {
      // Achado pelas duas buscas: sinal forte, some um reforço em vez de
      // simplesmente pegar o maior.
      prev.score = Math.max(prev.score, score) + 0.05;
      return;
    }
    byKey.set(row.doc_key, {
      docKey: row.doc_key,
      kind: (row.kind as SystemDoc["kind"]) ?? "route",
      title: row.title,
      content: row.content,
      sourcePath: row.source_path,
      score,
      retrieval,
    });
  };

  try {
    const { vector, usage: u } = await embedOne(params.query);
    usage = mergeUsage(usage, u);
    if (vector?.length) {
      const { data } = await db.rpc("match_ai_system_docs", {
        query_embedding: vector as unknown as string,
        match_count: limit,
      });
      for (const row of (data ?? []) as Row[]) take(row, Number(row.similarity ?? 0), "vector");
    }
  } catch (err) {
    console.error("[system-knowledge] busca vetorial falhou", err);
  }

  try {
    const { data } = await db.rpc("search_ai_system_docs_text", {
      _query: params.query,
      match_count: limit,
    });
    // ts_rank devolve valores baixos; a mesma normalização do rag.server.ts.
    for (const row of (data ?? []) as Row[]) take(row, Math.min(Number(row.rank ?? 0) * 4, 1), "text");
  } catch (err) {
    console.error("[system-knowledge] busca textual falhou", err);
  }

  const docs = Array.from(byKey.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { docs, usage };
}

/** Formata os trechos para o agente, marcando o que é regra e o que é tela. */
export function renderSystemDocs(docs: SystemDoc[]): string {
  if (!docs.length) return "(nada encontrado na documentação do sistema)";
  const label: Record<string, string> = {
    guide: "GUIA",
    rule: "REGRA DE NEGÓCIO",
    route: "TELA",
  };
  return docs
    .map((d, i) => `[${i + 1}] ${label[d.kind] ?? "DOC"} · ${d.title}\n${d.content}`)
    .join("\n\n");
}
