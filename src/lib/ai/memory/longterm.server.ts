/**
 * Long-Term Memory — memórias persistentes entre conversas (tabela ai_memories).
 *
 * Guarda perfil do hóspede, fatos do imóvel, problemas recorrentes, soluções
 * aplicadas e decisões operacionais. Escopos preparados para evolução:
 * guest | property | owner | provider | team | global.
 *
 * Regras de integridade:
 *  - toda memória carrega origem (source), data e confiança;
 *  - gravação é idempotente por hash de conteúdo (reforça `occurrences` em vez
 *    de duplicar);
 *  - memórias podem expirar (ttlDays) e perdem peso com o tempo (decay no
 *    Memory Retrieval System).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts, EMPTY_USAGE, mergeUsage, type Usage } from "../gateway.server";
import type { MemoryCandidate, MemoryKind, MemoryRecord, MemoryScope } from "./types";

type Admin = SupabaseClient;

export function hashContent(text: string): string {
  let h = 2166136261;
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function rowToRecord(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    scope: (row.scope as MemoryScope) ?? "guest",
    subjectKey: (row.subject_key as string) ?? null,
    kind: (row.kind as MemoryKind) ?? "fact",
    category: (row.category as string) ?? null,
    title: (row.title as string) ?? null,
    content: String(row.content ?? ""),
    source: String(row.source ?? "conversation"),
    importance: Number(row.importance ?? 0.5),
    confidence: Number(row.confidence ?? 0.7),
    lastSeenAt: String(row.last_seen_at ?? row.created_at ?? new Date().toISOString()),
    propertyId: (row.property_id as string) ?? null,
  };
}

export { rowToRecord };

/**
 * Grava (ou reforça) memórias de longo prazo. Nunca lança: memória é um ganho
 * marginal e jamais pode quebrar o atendimento.
 */
export async function writeMemories(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  subjectKey: string | null;
  guestName?: string | null;
  sourceRef?: string | null;
  candidates: MemoryCandidate[];
}): Promise<{ written: number; usage: Usage }> {
  const { supabase, candidates } = params;
  let usage = EMPTY_USAGE;
  const valid = candidates.filter((c) => c.content && c.content.trim().length > 8).slice(0, 8);
  if (!valid.length) return { written: 0, usage };

  let vectors: number[][] = [];
  try {
    const embedded = await embedTexts(valid.map((c) => `${c.title ?? ""}\n${c.content}`.trim()));
    usage = mergeUsage(usage, embedded.usage);
    vectors = embedded.vectors;
  } catch (err) {
    console.error("[memory] embedding falhou, gravando sem vetor", err);
  }

  const nowIso = new Date().toISOString();
  let written = 0;

  for (let i = 0; i < valid.length; i += 1) {
    const c = valid[i];
    const scope: MemoryScope = c.scope ?? "guest";
    const subjectKey = scope === "guest" ? params.subjectKey : (params.subjectKey ?? null);
    const contentHash = hashContent(c.content);
    const vector = vectors[i];
    const expiresAt =
      c.ttlDays && c.ttlDays > 0 ? new Date(Date.now() + c.ttlDays * 86400000).toISOString() : null;

    try {
      // Reforço: se a mesma memória já existe, incrementa ocorrências e renova a data.
      const { data: existing } = await supabase
        .from("ai_memories")
        .select("id, occurrences, importance")
        .eq("owner_id", params.ownerId)
        .eq("scope", scope)
        .eq("content_hash", contentHash)
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from("ai_memories")
          .update({
            occurrences: Number(existing.occurrences ?? 1) + 1,
            importance: Math.min(1, Number(existing.importance ?? 0.5) + 0.05),
            last_seen_at: nowIso,
            confidence: Math.min(1, c.confidence ?? 0.7),
            expires_at: expiresAt,
          })
          .eq("id", existing.id);
        written += 1;
        continue;
      }

      const { error } = await supabase.from("ai_memories").insert({
        owner_id: params.ownerId,
        property_id: params.propertyId,
        scope,
        subject_key: subjectKey,
        guest_name: params.guestName ?? null,
        kind: c.kind,
        category: c.category ?? null,
        title: c.title ?? null,
        content: c.content.slice(0, 2000),
        source: c.source ?? "conversation",
        source_ref: params.sourceRef ?? null,
        importance: Math.min(1, Math.max(0, c.importance ?? 0.5)),
        confidence: Math.min(1, Math.max(0, c.confidence ?? 0.7)),
        last_seen_at: nowIso,
        expires_at: expiresAt,
        author: c.author ?? null,
        approved_by: c.approvedBy ?? null,
        approved_at: c.approvedBy ? nowIso : null,
        metadata: (c.metadata ?? {}) as never,
        embedding: (vector ? (vector as unknown as string) : null) as never,
        content_hash: contentHash,
      });
      if (!error) written += 1;
    } catch (err) {
      console.error("[memory] gravação falhou", err);
    }
  }

  return { written, usage };
}

/** Últimas memórias de um escopo (sem busca semântica) — usado como fallback. */
export async function listRecentMemories(params: {
  supabase: Admin;
  ownerId: string;
  propertyId?: string | null;
  subjectKey?: string | null;
  kinds?: MemoryKind[];
  limit?: number;
}): Promise<MemoryRecord[]> {
  try {
    let query = params.supabase
      .from("ai_memories")
      .select(
        "id, scope, subject_key, kind, category, title, content, source, importance, confidence, last_seen_at, property_id",
      )
      .eq("owner_id", params.ownerId)
      .order("last_seen_at", { ascending: false })
      .limit(params.limit ?? 10);

    if (params.propertyId) query = query.or(`property_id.eq.${params.propertyId},property_id.is.null`);
    if (params.subjectKey) query = query.or(`subject_key.eq.${params.subjectKey},subject_key.is.null`);
    if (params.kinds?.length) query = query.in("kind", params.kinds);

    const { data } = await query;
    return ((data ?? []) as Array<Record<string, unknown>>).map(rowToRecord);
  } catch (err) {
    console.error("[memory] listagem falhou", err);
    return [];
  }
}
