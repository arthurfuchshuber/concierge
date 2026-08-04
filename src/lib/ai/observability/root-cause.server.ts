/**
 * Root Cause Analysis — "por que essa resposta aconteceu?".
 *
 * Monta (e depois recupera) o rastro completo de uma interação: agente
 * escolhido, contexto usado, memórias recuperadas, ferramentas chamadas,
 * fontes consultadas e a decisão final.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type RootCause = {
  decision: {
    agent: string;
    routingReason: string;
    autonomy: string;
    confidence: number;
    confidenceTier: string;
    handoff: boolean;
    handoffReason: string | null;
  };
  context: { keys: string[]; memoryUsed: boolean; humanAnswerUsed: boolean };
  memories: unknown;
  tools: unknown;
  sources: unknown;
  channel: { origin: string; reference: string | null };
  proactive: { trigger: string | null; autonomyLevel: string | null; approvalStatus: string | null };
};

export function buildRootCause(input: RootCause): RootCause {
  return input;
}

export type Explanation = {
  id: string;
  createdAt: string;
  question: string | null;
  agent: string;
  reason: string;
  confidence: number | null;
  confidenceTier: string | null;
  handoff: boolean;
  contextKeys: string[];
  memories: unknown;
  tools: unknown;
  sources: unknown;
  channel: string | null;
  promptVersions: unknown;
  models: unknown;
  rootCause: unknown;
  narrative: string;
};

/** Recupera e narra o porquê de uma resposta específica (auditoria). */
export async function explainInteraction(params: {
  supabase: SupabaseClient;
  tenantId: string;
  logId: string;
}): Promise<Explanation | null> {
  const { data } = await params.supabase
    .from("ai_agent_logs")
    .select("*")
    .eq("id", params.logId)
    .eq("tenant_id", params.tenantId)
    .maybeSingle();
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const intent = (row.intent ?? {}) as Record<string, unknown>;
  const agent = String(row.selected_agent ?? "generalist");
  const tools = Array.isArray(row.tools_used) ? (row.tools_used as Array<Record<string, unknown>>) : [];
  const sources = Array.isArray(row.sources) ? (row.sources as Array<Record<string, unknown>>) : [];

  const narrative = [
    `Agente escolhido: ${agent} (${String(row.orchestrator_decision ?? "roteamento padrão")}).`,
    `Intenção detectada: ${String(intent.intent ?? "n/d")} (categoria ${String(intent.category ?? "n/d")}, urgência ${String(intent.urgency ?? "n/d")}).`,
    `Contexto usado: ${(row.context_keys as string[] | null)?.join(", ") || "nenhum"}.`,
    `Memórias: ${row.memory_context_used ? "sim" : "não"} · decisão humana anterior: ${row.human_response_used ? "sim" : "não"}.`,
    `Ferramentas: ${tools.map((t) => String(t.name)).join(", ") || "nenhuma"}.`,
    `Fontes: ${sources.map((s) => String(s.source)).join(", ") || "nenhuma"}.`,
    `Confiança final: ${row.confidence ?? "n/d"} (${String(row.confidence_tier ?? "n/d")}) · escalonou: ${row.needs_human ? "sim" : "não"}.`,
    `Canal de origem: ${String(row.channel_origin ?? "guide_chat")}.`,
  ].join("\n");

  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    question: (intent.intent as string) ?? null,
    agent,
    reason: String(row.orchestrator_decision ?? ""),
    confidence: row.confidence as number | null,
    confidenceTier: (row.confidence_tier as string) ?? null,
    handoff: !!row.needs_human,
    contextKeys: (row.context_keys as string[]) ?? [],
    memories: row.memories_retrieved,
    tools,
    sources,
    channel: (row.channel_origin as string) ?? null,
    promptVersions: row.prompt_versions,
    models: row.models,
    rootCause: row.root_cause,
    narrative,
  };
}
