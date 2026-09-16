/**
 * FASE 8 — Memory Intelligence.
 *
 * Memórias ganham peso quando ajudam e perdem quando aparecem em conversas
 * malsucedidas. Memórias com falha recorrente expiram para revisão humana.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationOutcome } from "./types";

type Admin = SupabaseClient;

/** Registra uso das memórias que participaram de uma resposta. */
export async function bumpMemoryUsage(params: {
  supabase: Admin;
  memoryIds: string[];
  outcome: "success" | "failure" | "neutral";
}): Promise<void> {
  const ids = [...new Set(params.memoryIds.filter(Boolean))];
  if (!ids.length) return;
  try {
    await params.supabase.rpc("bump_memory_usage", { _ids: ids, _outcome: params.outcome });
  } catch (err) {
    console.error("[learning:memory] falha ao atualizar uso de memória", err);
  }
}

export function outcomeToSignal(outcome: ConversationOutcome): "success" | "failure" | "neutral" {
  if (outcome === "SUCCESS") return "success";
  if (outcome === "FAILURE") return "failure";
  return "neutral";
}

/** Aplica o desfecho da conversa às memórias efetivamente usadas nela. */
export async function applyOutcomeToMemories(params: {
  supabase: Admin;
  conversationId: string;
  outcome: ConversationOutcome;
}): Promise<number> {
  try {
    const { data } = await params.supabase
      .from("ai_agent_logs")
      .select("memories_retrieved")
      .eq("conversation_id", params.conversationId)
      .limit(40);

    const ids: string[] = [];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const list = Array.isArray(row.memories_retrieved) ? row.memories_retrieved : [];
      for (const m of list) {
        const id = (m as Record<string, unknown>)?.["id"];
        if (id) ids.push(String(id));
      }
    }
    if (!ids.length) return 0;
    await bumpMemoryUsage({ supabase: params.supabase, memoryIds: ids, outcome: outcomeToSignal(params.outcome) });
    return new Set(ids).size;
  } catch (err) {
    console.error("[learning:memory] falha ao aplicar desfecho", err);
    return 0;
  }
}

/**
 * Expira memórias que falham de forma consistente (>=3 falhas e taxa de
 * sucesso abaixo de 30%). Elas saem do contexto e ficam para revisão humana.
 */
export async function quarantineFailingMemories(params: {
  supabase: Admin;
  tenantId: string;
}): Promise<number> {
  try {
    const { data } = await params.supabase
      .from("ai_memories")
      .select("id, success_count, failure_count, metadata")
      .eq("tenant_id", params.tenantId)
      .gte("failure_count", 3)
      .is("expires_at", null)
      .limit(200);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const failing = rows.filter((r) => {
      const s = Number(r.success_count ?? 0);
      const f = Number(r.failure_count ?? 0);
      return f >= 3 && s / Math.max(1, s + f) < 0.3;
    });
    if (!failing.length) return 0;

    const now = new Date().toISOString();
    for (const row of failing) {
      await params.supabase
        .from("ai_memories")
        .update({
          expires_at: now,
          confidence: 0.2,
          metadata: {
            ...((row.metadata as Record<string, unknown>) ?? {}),
            quarantined_at: now,
            quarantine_reason: "taxa de sucesso baixa após uso repetido",
          } as never,
        })
        .eq("id", row.id as string);
    }
    return failing.length;
  } catch (err) {
    console.error("[learning:memory] falha ao colocar memórias em quarentena", err);
    return 0;
  }
}
