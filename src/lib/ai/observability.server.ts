/**
 * Observabilidade da IA — logs completos por interação (somente admin/servidor).
 * Nunca exibido ao hóspede.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Usage } from "./gateway.server";

export type AgentLog = {
  ownerId: string | null;
  propertyId: string | null;
  conversationId: string | null;
  surface: string;
  intent: unknown;
  contextKeys: string[];
  toolsUsed: Array<{ name: string; args?: unknown }>;
  sources: Array<{ source: string; title?: string | null; confidence: number }>;
  confidence: number | null;
  validation: unknown;
  models: Record<string, string>;
  usage: Usage;
  latencyMs: number;
  needsHuman: boolean;
  error?: string | null;
};

export async function logAgentRun(supabase: SupabaseClient, log: AgentLog): Promise<void> {
  try {
    await supabase.from("ai_agent_logs").insert({
      owner_id: log.ownerId,
      property_id: log.propertyId,
      conversation_id: log.conversationId,
      surface: log.surface,
      intent: log.intent as never,
      context_keys: log.contextKeys as never,
      tools_used: log.toolsUsed as never,
      sources: log.sources as never,
      confidence: log.confidence,
      validation: log.validation as never,
      models: log.models as never,
      tokens: { input: log.usage.inputTokens, output: log.usage.outputTokens } as never,
      cost_estimate: Number(log.usage.costUsd.toFixed(6)),
      latency_ms: log.latencyMs,
      needs_human: log.needsHuman,
      error: log.error ?? null,
    });
  } catch (err) {
    // Observabilidade nunca pode quebrar o atendimento.
    console.error("[ai-log] falha ao registrar", err);
  }
}
