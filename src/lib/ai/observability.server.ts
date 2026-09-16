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
  toolsUsed: Array<{ name: string; args?: unknown; durationMs?: number; parallelBatch?: number }>;
  sources: Array<{ source: string; title?: string | null; confidence: number }>;
  confidence: number | null;
  validation: unknown;
  models: Record<string, string>;
  usage: Usage;
  latencyMs: number;
  needsHuman: boolean;
  error?: string | null;
  /** Plano de execução gerado pelo Planner Agent. */
  plan?: unknown;
  /** Resultado do Reflection Step. */
  reflection?: unknown;
  /** Versões dos prompts usados nesta interação. */
  promptVersions?: Record<string, string>;
  /** Nível de confiança resultante: auto | hedged | handoff. */
  confidenceTier?: string | null;
  /** Peso médio das fontes efetivamente consultadas. */
  sourceWeight?: number | null;
  /** true quando alguma memória foi injetada no raciocínio. */
  memoryContextUsed?: boolean;
  /** Memórias recuperadas (id, tier, tipo, score) — auditoria. */
  memoriesRetrieved?: unknown;
  /** Confiança agregada das memórias usadas. */
  memoryConfidenceScore?: number | null;
  /** Retrato do contexto do hóspede no momento da resposta. */
  guestContextSnapshot?: unknown;
  /** Retrato do contexto operacional no momento da resposta. */
  operationalContextSnapshot?: unknown;
  /** Agente especialista que assumiu o atendimento. */
  selectedAgent?: string | null;
  /** Nível de autonomia do agente selecionado. */
  agentAutonomy?: string | null;
  /** Decisão do supervisor (roteamento). */
  orchestratorDecision?: unknown;
  /** true quando a IA perguntou a um humano nesta interação. */
  escalationTriggered?: boolean;
  escalationId?: string | null;
  /** true quando uma decisão humana foi usada na resposta. */
  humanResponseUsed?: boolean;
  /** true quando a interação gerou candidata a conhecimento. */
  learningCreated?: boolean;
  /** Empresa (tenant) dona da interação — isolamento multiempresa. */
  tenantId?: string | null;
  /** Nota de avaliação quando a interação veio do Evaluation Framework. */
  evaluationScore?: number | null;
  /** Resultado do teste de regressão associado. */
  regressionTestResult?: string | null;
  /** Canal de origem da mensagem (guide_chat, whatsapp, airbnb, email…). */
  channelOrigin?: string | null;
  channelReference?: string | null;
  /** Gatilho proativo que originou a interação, quando houver. */
  proactiveTrigger?: string | null;
  /** Limite de autonomia aplicado à ação. */
  autonomyLevel?: string | null;
  /** Status de aprovação humana da ação. */
  actionApprovalStatus?: string | null;
  /** Rastro completo para Root Cause Analysis. */
  rootCause?: unknown;
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
      plan: (log.plan ?? null) as never,
      reflection: (log.reflection ?? null) as never,
      prompt_versions: (log.promptVersions ?? null) as never,
      confidence_tier: log.confidenceTier ?? null,
      source_weight: log.sourceWeight ?? null,
      memory_context_used: log.memoryContextUsed ?? false,
      memories_retrieved: (log.memoriesRetrieved ?? null) as never,
      memory_confidence_score: log.memoryConfidenceScore ?? null,
      guest_context_snapshot: (log.guestContextSnapshot ?? null) as never,
      operational_context_snapshot: (log.operationalContextSnapshot ?? null) as never,
      selected_agent: log.selectedAgent ?? null,
      orchestrator_decision: (log.orchestratorDecision ?? null) as never,
      escalation_triggered: log.escalationTriggered ?? false,
      escalation_id: log.escalationId ?? null,
      human_response_used: log.humanResponseUsed ?? false,
      learning_created: log.learningCreated ?? false,
      tenant_id: log.tenantId ?? log.ownerId ?? null,
      evaluation_score: log.evaluationScore ?? null,
      regression_test_result: log.regressionTestResult ?? null,
      channel_origin: log.channelOrigin ?? "guide_chat",
      channel_reference: log.channelReference ?? null,
      proactive_trigger: log.proactiveTrigger ?? null,
      autonomy_level: log.autonomyLevel ?? null,
      action_approval_status: log.actionApprovalStatus ?? null,
      root_cause: (log.rootCause ?? null) as never,
    });

  } catch (err) {
    // Observabilidade nunca pode quebrar o atendimento.
    console.error("[ai-log] falha ao registrar", err);
  }
}
