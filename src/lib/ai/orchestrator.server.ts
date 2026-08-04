/**
 * Orquestrador do Agente de Hospitalidade.
 *
 * Pipeline por mensagem:
 *   1. Classificação de intenção (modelo rápido)
 *   2. Planner Agent (plano de execução: quais ferramentas realmente usar)
 *   3. Coleta de contexto (residência, reserva, fase da estadia, memória)
 *   4. Pré-recuperação Hybrid RAG (vetorial + textual)
 *   5. Raciocínio + tool calling paralelo (agente principal)
 *   6. Validação final (anti-alucinação)
 *   7. Reflection Step (autoavaliação e melhoria da redação)
 *   8. Confidence Threshold (auto | com ressalva | handoff)
 *   9. Observabilidade (log completo, com versão dos prompts)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_USAGE, mergeUsage, runAgent, type Usage } from "./gateway.server";
import { classifyIntent, type Intent } from "./intent.server";
import { buildAgentContext } from "./context.server";
import { hybridRetrieve, renderPassages } from "./rag.server";
import { buildGuestTools, type ToolContext } from "./tools.server";
import { validateAnswer } from "./validate.server";
import { guestKeyOf, loadGuestMemory, updateGuestMemory } from "./memory.server";
import { logAgentRun } from "./observability.server";
import { AI_MODELS } from "./models";
import { PROMPTS, HANDOFF_FALLBACK, stampVersions } from "./prompts";
import { planExecution, renderPlan, type ExecutionPlan } from "./planner.server";
import { reflectOnAnswer, type Reflection } from "./reflection.server";
import { aggregateSourceWeight, renderSourceRanking } from "./sources";
import {
  aggregateConfidence,
  hedgeNotice,
  thresholdsFor,
  tierFor,
  type ConfidenceTier,
} from "./confidence";

type Admin = SupabaseClient;

export type OrchestratorResult = {
  reply: string;
  handoff: boolean;
  handoffReason: string | null;
  handoffUrgency: "low" | "normal" | "high";
  intent: Intent;
  usage: Usage;
  confidence: number;
  confidenceTier: ConfidenceTier;
  plan: ExecutionPlan;
  reflection: Reflection | null;
};

export async function runHospitalityAgent(params: {
  supabase: Admin;
  property: Record<string, unknown>;
  conversationId: string;
  sessionId: string;
  guestName: string | null;
  message: string;
  history: Array<{ role: string; content: string }>;
  explorationMode?: boolean;
  surface?: string;
}): Promise<OrchestratorResult> {
  const started = Date.now();
  const { supabase, property } = params;
  const propertyId = String(property.id);
  const ownerId = String(property.owner_id);

  let usage = EMPTY_USAGE;
  const models: Record<string, string> = { agent: AI_MODELS.agent };
  const sources: Array<{ source: string; title?: string | null; confidence: number }> = [];
  const evidence: string[] = [];
  let handoffReason: string | null = null;
  let handoffUrgency: "low" | "normal" | "high" = "normal";

  // 1) Intenção
  const { intent, usage: intentUsage, model: intentModel } = await classifyIntent(params.message, params.history);
  usage = mergeUsage(usage, intentUsage);
  models.intent = intentModel;

  const guestKey = guestKeyOf(params.sessionId, params.guestName);
  rememberMessage(params.conversationId, "user", params.message);
  rememberIntent(params.conversationId, intent);

  // 2) Guest Context Engine + Memory Retrieval (curto prazo, longo prazo, operacional)
  const memory = await loadGuestMemory(supabase, propertyId, guestKey);
  const guestContext = await buildGuestContext({
    supabase,
    ownerId,
    propertyId,
    conversationId: params.conversationId,
    guestKey,
    guestName: params.guestName,
    message: params.message,
    history: params.history,
    category: intent.category,
    language: intent.language,
    memory,
    searchQuery: intent.searchQuery,
  });
  usage = mergeUsage(usage, guestContext.usage);
  for (const m of guestContext.memories) {
    sources.push({ source: "memory", title: m.title, confidence: m.confidence * m.decay });
  }
  if (guestContext.operational.length) {
    sources.push({ source: "operational_memory", title: "histórico operacional", confidence: 0.8 });
  }

  // Assunto em aberto: problema operacional continua vivo na sessão.
  if (intent.category === "operacional" || intent.urgency === "high") {
    setOpenTopic(params.conversationId, params.message, "issue");
  }

  // 3) Planner Agent — plano de execução já ciente do contexto e da memória
  const { plan, usage: planUsage, model: plannerModel } = await planExecution({
    message: params.message,
    intent,
    history: params.history,
    explorationMode: params.explorationMode,
    contextHint: guestContext.text.slice(0, 2500),
  });
  usage = mergeUsage(usage, planUsage);
  if (plannerModel) models.planner = plannerModel;
  rememberPlan(params.conversationId, plan);

  const context = await buildAgentContext({ supabase, property, guestName: params.guestName, memory });


  // 4) Pré-recuperação Hybrid RAG (indexa sob demanda na primeira vez)
  const { count: chunkCount } = await supabase
    .from("ai_kb_chunks")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);
  if (!chunkCount) {
    try {
      const { reindexProperty } = await import("./indexing.server");
      const { usage: idxUsage } = await reindexProperty(supabase, propertyId);
      usage = mergeUsage(usage, idxUsage);
    } catch (err) {
      console.error("[agent] indexação inicial falhou", err);
    }
  }

  const { passages, usage: ragUsage, retrievalUsed } = await hybridRetrieve({
    supabase,
    ownerId,
    propertyId,
    query: intent.searchQuery || params.message,
  });
  usage = mergeUsage(usage, ragUsage);
  for (const p of passages) {
    sources.push({ source: p.source, title: p.title, confidence: p.confidence });
    evidence.push(`[${p.source}] ${p.title ?? ""}: ${p.content}`);
  }

  // 5) Agente com ferramentas (execução paralela por rodada)
  const toolCtx: ToolContext = {
    supabase,
    ownerId,
    propertyId,
    property,
    conversationId: params.conversationId,
    guestName: params.guestName,
    sensitiveLocked: context.sensitiveLocked,
    collectSource: (entry) => {
      sources.push({ source: entry.source, title: entry.title, confidence: entry.confidence });
      if (entry.content) evidence.push(`[${entry.source}] ${entry.content}`);
    },
    requestHandoff: (reason, urgency) => {
      handoffReason = reason;
      handoffUrgency = urgency;
    },
  };
  const tools = buildGuestTools(toolCtx);

  const instructions =
    PROMPTS.agent.text +
    (params.explorationMode ? PROMPTS.exploration.text : "") +
    (context.behavior
      ? `\n\nCOMPORTAMENTO DEFINIDO PELO ANFITRIÃO (prioridade máxima, siga estritamente)\n${context.behavior}`
      : "") +
    `\n\nRANKING PERMANENTE DE FONTES (em conflito, o tier menor sempre vence)\n${renderSourceRanking()}` +
    `\n\nCONTEXTO ATUAL\n${context.text}` +
    `\n\nINTENÇÃO DETECTADA: ${intent.intent} (categoria=${intent.category}, urgência=${intent.urgency}, idioma=${intent.language})` +
    `\n\nPLANO DE EXECUÇÃO (definido pelo planejador)\n${renderPlan(plan)}` +
    `\n\nEVIDÊNCIAS PRÉ-RECUPERADAS (busca híbrida: ${retrievalUsed.join("+") || "nenhuma"})\n${renderPassages(passages)}`;

  const input = [
    ...params.history.slice(-12).map((m) => ({
      type: "message",
      role: m.role === "assistant" ? "assistant" : "user",
      content: [{ type: m.role === "assistant" ? "output_text" : "input_text", text: m.content }],
    })),
    { type: "message", role: "user", content: [{ type: "input_text", text: params.message }] },
  ];

  let reply = "";
  let toolsUsed: Array<{ name: string; args?: unknown; durationMs?: number; parallelBatch?: number }> = [];
  let errorMsg: string | null = null;

  try {
    const run = await runAgent({
      task: "agent",
      instructions,
      input,
      tools,
      maxSteps: 6,
      reasoningEffort: intent.urgency === "high" || plan.riskLevel === "high" ? "medium" : "low",
    });
    usage = mergeUsage(usage, run.usage);
    reply = run.text.trim();
    toolsUsed = run.toolCalls.map((c) => ({
      name: c.name,
      args: c.args,
      durationMs: c.durationMs,
      parallelBatch: c.parallelBatch,
    }));
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[agent] execução falhou", err);
    throw err;
  }

  if (handoffReason && !reply) reply = HANDOFF_FALLBACK;

  // 6) Validação + 7) Reflection (puladas quando já escalamos para humano)
  const thresholds = thresholdsFor({
    explorationMode: params.explorationMode,
    category: intent.category,
    urgency: intent.urgency,
  });
  const evidenceText = evidence.slice(0, 24).join("\n\n") || "(nenhuma evidência recuperada)";
  let validationResult: unknown = null;
  let reflection: Reflection | null = null;
  let confidence = 0.8;
  let tier: ConfidenceTier = "auto";

  if (reply && !handoffReason) {
    const [validated, reflected] = await Promise.all([
      validateAnswer({
        question: params.message,
        answer: reply,
        evidence: evidenceText,
        language: intent.language,
        policies: context.behavior || undefined,
      }),
      reflectOnAnswer({
        question: params.message,
        answer: reply,
        evidence: evidenceText,
        language: intent.language,
        history: params.history,
      }),
    ]);

    usage = mergeUsage(usage, validated.usage);
    usage = mergeUsage(usage, reflected.usage);
    models.validation = validated.model;
    if (reflected.model) models.reflection = reflected.model;
    validationResult = validated.validation;
    reflection = reflected.reflection;

    // Melhoria da redação sugerida pela autoavaliação (sem fatos novos).
    if (reflection.improvedAnswer && !reflection.needsHuman && validated.validation.approved) {
      reply = reflection.improvedAnswer;
    }

    // 8) Confidence Threshold
    confidence = aggregateConfidence({
      validation: validated.validation.confidence,
      reflection: reflection.skipped ? null : reflection.score,
      sourceWeight: aggregateSourceWeight(sources),
      riskLevel: plan.riskLevel,
    });
    tier = tierFor(confidence, thresholds);

    const forcedHuman =
      (!validated.validation.approved && validated.validation.needsHuman) || reflection.needsHuman;

    if (!params.explorationMode && (tier === "handoff" || forcedHuman)) {
      handoffReason =
        `Confiança insuficiente (${Math.round(confidence * 100)}%, nível=${tier}). ` +
        `${validated.validation.reason || reflection.issues.join("; ") || "inconsistência"}. ` +
        `Pergunta: ${params.message.slice(0, 160)}`;
      handoffUrgency = intent.urgency === "high" ? "high" : "normal";
      reply = HANDOFF_FALLBACK;
      tier = "handoff";
    } else if (tier === "hedged" && !params.explorationMode) {
      reply = `${reply}${hedgeNotice(intent.language)}`;
    }
  } else if (handoffReason) {
    tier = "handoff";
    confidence = 1;
  }

  // 9) Memória + observabilidade (não bloqueiam a resposta)
  const transcript = [...params.history, { role: "user", content: params.message }, { role: "assistant", content: reply }];
  void updateGuestMemory({
    supabase,
    ownerId,
    propertyId,
    guestKey,
    guestName: params.guestName,
    language: intent.language,
    previous: memory,
    transcript,
  }).catch(() => undefined);

  void logAgentRun(supabase, {
    ownerId,
    propertyId,
    conversationId: params.conversationId,
    surface: params.surface ?? "guide_chat",
    intent,
    contextKeys: context.keys,
    toolsUsed,
    sources,
    confidence,
    validation: validationResult,
    models,
    usage,
    latencyMs: Date.now() - started,
    needsHuman: !!handoffReason,
    error: errorMsg,
    plan,
    reflection,
    promptVersions: stampVersions(["agent", "planner", "reflection", ...(params.explorationMode ? (["exploration"] as const) : [])]),
    confidenceTier: tier,
    sourceWeight: aggregateSourceWeight(sources),
  }).catch(() => undefined);

  return {
    reply,
    handoff: !!handoffReason,
    handoffReason,
    handoffUrgency,
    intent,
    usage,
    confidence,
    confidenceTier: tier,
    plan,
    reflection,
  };
}
