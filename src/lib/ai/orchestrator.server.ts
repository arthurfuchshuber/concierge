/**
 * Orquestrador do Agente de Hospitalidade (arquitetura multi-agente).
 *
 * Pipeline por mensagem:
 *   1. Classificação de intenção (modelo rápido)
 *   2. Guest Context Engine + Memory Retrieval (curto prazo, longo prazo, operacional)
 *   2b. Supervisor Agent — escolhe o especialista (Reserva, Manutenção, Experiência,
 *       Recuperação, Receita ou Generalista) e define autonomia e ferramentas
 *   3. Planner Agent (plano de execução, já ciente do contexto e da memória)
 *   3b. Coleta de contexto (residência, reserva, fase da estadia)
 *   4. Pré-recuperação Hybrid RAG (vetorial + textual)
 *   4b. Human-in-the-loop: decisões humanas pendentes entram como verdade absoluta
 *   5. Raciocínio + tool calling paralelo (agente especialista, whitelist de ferramentas)
 *   6. Validação final (anti-alucinação)
 *   7. Reflection Step (autoavaliação e melhoria da redação)
 *   8. Confidence Threshold do próprio agente (auto | com ressalva | handoff)
 *   9. Gravação seletiva de memória + observabilidade (log completo)
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
import { buildGuestContext } from "./memory/guest-context.server";
import {
  clearOpenTopic,
  rememberEntities,
  rememberIntent,
  rememberMessage,
  rememberPlan,
  rememberTools,
  setOpenTopic,
} from "./memory/shortterm.server";
import { classifyForMemory } from "./memory/policy.server";
import { writeMemories } from "./memory/longterm.server";
import { recordOperationalRequest } from "./memory/operational.server";
import { AI_MODELS } from "./models";
import { PROMPTS, stampVersions, HANDOFF_FALLBACK } from "./prompts";
import { planExecution, renderPlan, type ExecutionPlan } from "./planner.server";
import { reflectOnAnswer, type Reflection } from "./reflection.server";
import { aggregateSourceWeight, confidenceOf, renderSourceRanking } from "./sources";
import {
  aggregateConfidence,
  hedgeNotice,
  thresholdsFor,
  tierFor,
  type ConfidenceTier,
} from "./confidence";
import { allowedToolsOf, getAgent, renderAgentBriefing, stampAgentPrompt } from "./agents/registry.server";
import { describeRouting, routeToAgent } from "./agents/supervisor.server";
import { buildAgentTools } from "./agents/tools.server";
import type { AgentRouting } from "./agents/types";
import {
  markAnswersApplied,
  pendingHumanAnswers,
  pendingNotice,
  renderHumanAnswers,
} from "./human-loop/escalations.server";
import { learnFromHumanAnswer } from "./human-loop/learning.server";
import { bumpMemoryUsage } from "./learning/memory-intelligence.server";
import { tenantOf } from "./tenant/context.server";
import { bindConversationChannel } from "./channels/gateway.server";
import type { ChannelType } from "./channels/types";
import { buildRootCause } from "./observability/root-cause.server";
import { guestSafetyDecision } from "./guest-safety.server";

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
  routing: AgentRouting;
  escalationId: string | null;
  /** Empresa (tenant) dona da interação. */
  tenantId: string;
  /** Canal de origem normalizado. */
  channel: ChannelType;
  /** Ferramentas efetivamente chamadas (auditoria/avaliação). */
  toolsUsed: Array<{ name: string; args?: unknown; durationMs?: number; parallelBatch?: number }>;
  /** Fontes efetivamente consultadas (auditoria/avaliação). */
  sourcesUsed: string[];
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
  /** Canal de origem (Channel Gateway). O núcleo não muda de comportamento por canal. */
  channel?: ChannelType;
  channelReference?: string | null;
  /** Gatilho proativo, quando a interação nasceu de uma ação antecipada. */
  proactiveTrigger?: string | null;
  autonomyLevel?: string | null;
  /** Progresso em tempo real do pipeline (streaming para a UI do hóspede). */
  onStage?: (stage: { step: string; label: string }) => void;
}): Promise<OrchestratorResult> {
  const started = Date.now();
  const { supabase, property } = params;
  const tenant = tenantOf(property);
  const propertyId = String(property.id);
  const ownerId = tenant.ownerId;
  const channel: ChannelType = params.channel ?? "guide_chat";
  const stage = (step: string, label: string) => {
    try {
      params.onStage?.({ step, label });
    } catch {
      /* streaming nunca pode quebrar o pipeline */
    }
  };
  stage("intent", "Entendendo sua pergunta");




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

  // Guardrail determinístico: acesso físico e credenciais não dependem de decisão do modelo.
  const safety = await guestSafetyDecision(params.message, String(property.slug ?? ""), { supabase, propertyId });
  if (safety.kind !== "none") {
    const handoff = safety.kind === "access_incident";
    const plan: ExecutionPlan = {
      objective: safety.kind === "access_incident" ? "Proteger o hóspede em incidente de acesso" : "Orientar o acesso seguro ao guia",
      tools: handoff ? [{ name: "request_human_handoff", reason: "incidente de acesso físico" }] : [],
      parallel: false,
      needsHuman: handoff,
      riskLevel: handoff ? "high" : "normal",
      notes: "Regra determinística de segurança; geração por IA não é permitida neste caso.",
      fallback: false,
    };
    const routing: AgentRouting = {
      agent: handoff ? "maintenance" : "reservation",
      reason: "regra determinística de segurança para acesso e credenciais",
      confidence: 1,
      escalateUpfront: handoff,
      fallback: false,
    };
    if (handoff) {
      void recordOperationalRequest({
        supabase,
        ownerId,
        propertyId,
        conversationId: params.conversationId,
        guestKey,
        guestName: params.guestName,
        category: "acesso",
        request: params.message.slice(0, 800),
        metadata: { intent: intent.intent, urgency: "high", handoff: true, source: "deterministic_guest_safety" },
      }).catch(() => undefined);
    }
    return {
      reply: safety.reply,
      handoff,
      handoffReason: handoff ? "Incidente de acesso físico relatado pelo hóspede." : null,
      handoffUrgency: handoff ? "high" : "normal",
      intent,
      usage,
      confidence: 1,
      confidenceTier: "auto",
      plan,
      reflection: null,
      routing,
      escalationId: null,
      tenantId: tenant.tenantId,
      channel,
      toolsUsed: handoff ? [{ name: "request_human_handoff" }] : [],
      sourcesUsed: ["guest_safety_policy"],
    };
  }

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

  // 2b) Supervisor Agent + 3) Planner Agent — rodam em paralelo: nenhum dos dois
  // depende do resultado do outro, só de `intent`/`guestContext`. Antes rodavam em
  // série (mais um round-trip de LLM por mensagem, sem necessidade).
  const [
    { routing, usage: routeUsage, model: supervisorModel },
    { plan, usage: planUsage, model: plannerModel },
  ] = await Promise.all([
    routeToAgent({
      message: params.message,
      category: intent.category,
      urgency: intent.urgency,
      history: params.history,
      contextHint: guestContext.text.slice(0, 1200),
    }),
    planExecution({
      message: params.message,
      intent,
      history: params.history,
      explorationMode: params.explorationMode,
      contextHint: guestContext.text.slice(0, 2500),
    }),
  ]);
  usage = mergeUsage(usage, routeUsage);
  if (supervisorModel) models.supervisor = supervisorModel;
  const agent = getAgent(routing.agent);
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
    // Teto de tempo: gerar embeddings pode demorar bastante para um guia grande.
    // Antes, isso bloqueava a primeira mensagem do hóspede sem limite nenhum.
    // Com o teto, se estourar, a resposta desta mensagem segue sem RAG (ainda
    // assim gera algo, só sem evidência), e a próxima mensagem já encontra os
    // chunks prontos (a indexação em si roda até o fim, só paramos de esperar).
    try {
      const { reindexProperty } = await import("./indexing.server");
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000));
      const result = await Promise.race([reindexProperty(supabase, propertyId), timeout]);
      if (result) {
        usage = mergeUsage(usage, result.usage);
      } else {
        console.warn("[agent] indexação inicial excedeu o teto de 12s — seguindo sem esperar");
      }
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

  // 4b) Human-in-the-loop: decisões humanas pendentes desta conversa +
  // Conhecimento da empresa (ai_tenant_knowledge/ai_global_intelligence) — cadastrado
  // no painel mas, até esta correção, nunca lido por nenhuma camada do pipeline de
  // resposta (só pela própria tela de cadastro). Rodam em paralelo com o passo acima
  // para não somar latência sequencial.
  const [humanAnswers, tenantKnowledgeText, globalIntelPassages] = await Promise.all([
    pendingHumanAnswers({ supabase, conversationId: params.conversationId }),
    (async () => {
      try {
        const { listTenantKnowledge } = await import("./governance/tenant-knowledge.server");
        const rows = await listTenantKnowledge({ supabase, tenantId: ownerId, status: "active" });
        const scoped = rows.filter((r) => !r.property_id || r.property_id === propertyId).slice(0, 20);
        if (!scoped.length) return "";
        return scoped
          .map((r) => `- [${r.category ?? "geral"}] ${r.title}: ${String(r.content ?? "").slice(0, 500)}`)
          .join("\n");
      } catch (err) {
        console.error("[agent] falha ao ler conhecimento da empresa", err);
        return "";
      }
    })(),
    (async () => {
      try {
        const { listGlobalIntelligence } = await import("./governance/global-intelligence.server");
        const rows = await listGlobalIntelligence({ supabase, status: "published" });
        return rows
          .filter((r) => typeof r.confidence === "number" && (r.confidence as number) >= 0.7)
          .slice(0, 8)
          .map((r) => ({
            title: String(r.title ?? ""),
            content: String(r.insight ?? "").slice(0, 400),
          }));
      } catch (err) {
        console.error("[agent] falha ao ler global intelligence", err);
        return [] as Array<{ title: string; content: string }>;
      }
    })(),
  ]);
  for (const a of humanAnswers) {
    sources.push({ source: "human_decision", title: "decisão da equipe", confidence: 1 });
    evidence.push(`[human_decision] ${a.question} → ${a.answer}`);
  }
  for (const g of globalIntelPassages) {
    // Insight agregado da plataforma, não fato oficial deste imóvel: fica no tier
    // mais baixo do ranking de fontes (ver sources.ts) — nunca sobrepõe dado oficial.
    sources.push({ source: "global_intelligence", title: g.title, confidence: confidenceOf("global_intelligence") });
    evidence.push(`[global_intelligence] ${g.title}: ${g.content}`);
  }

  // 5) Agente especialista com ferramentas (whitelist do registry)
  let escalationId: string | null = null;
  let escalationQuestion: string | null = null;

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
  const tools = allowedToolsOf(agent, [
    ...buildGuestTools(toolCtx),
    ...buildAgentTools({
      ...toolCtx,
      agent: agent.key,
      guestKey,
      onEscalation: (info) => {
        escalationId = info.id;
        escalationQuestion = info.question;
      },
    }),
  ]);

  const instructions =
    PROMPTS.agent.text +
    (params.explorationMode ? PROMPTS.exploration.text : "") +
    `\n\n=== SEU PAPEL NESTA CONVERSA ===\n${renderAgentBriefing(agent)}` +
    (context.behavior
      ? `\n\nCOMPORTAMENTO DEFINIDO PELO ANFITRIÃO (prioridade máxima, siga estritamente)\n${context.behavior}`
      : "") +
    (tenantKnowledgeText
      ? `\n\nCONHECIMENTO DA EMPRESA (políticas/procedimentos internos cadastrados pelo anfitrião — trate como regra oficial, não como sugestão)\n${tenantKnowledgeText}`
      : "") +
    `\n\nRANKING PERMANENTE DE FONTES (em conflito, o tier menor sempre vence)\n${renderSourceRanking()}` +
    `\n\nCONTEXTO ATUAL\n${context.text}` +
    `\n\nCONTEXTO DO HÓSPEDE E MEMÓRIA (uso interno — nunca revele ao hóspede que existe histórico registrado)\n${guestContext.text}` +
    renderHumanAnswers(humanAnswers) +
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
      maxSteps: agent.maxSteps,
      reasoningEffort:
        intent.urgency === "high" || plan.riskLevel === "high" ? "medium" : agent.reasoningEffort,
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

  rememberTools(
    params.conversationId,
    toolsUsed.map((t) => ({ name: t.name, args: t.args, ok: true, at: Date.now() })),
  );

  // Perguntou a um humano: responde com honestidade, nunca inventa.
  if (escalationId && !reply) reply = pendingNotice(intent.language);
  // Handoff NÃO é mais silencioso: a IA entrega a resposta parcial que
  // conseguiu montar e sinaliza a consulta interna. Só usamos o fallback
  // quando o modelo não produziu nada aproveitável.
  if (handoffReason && !reply) reply = HANDOFF_FALLBACK;

  // Decisões humanas já entregues ao hóspede não voltam ao contexto.
  if (humanAnswers.length && reply) {
    void markAnswersApplied({ supabase, ids: humanAnswers.map((a) => a.id) }).catch(() => undefined);
  }


  // 6) Validação + 7) Reflection (puladas quando já escalamos para humano)
  const baseThresholds = thresholdsFor({
    explorationMode: params.explorationMode,
    category: intent.category,
    urgency: intent.urgency,
  });
  // O agente especialista pode exigir confiança maior que a categoria.
  const thresholds = params.explorationMode
    ? baseThresholds
    : {
        auto: Math.max(baseThresholds.auto, agent.thresholds.auto),
        hedged: Math.max(baseThresholds.hedged, agent.thresholds.hedged),
      };

  const evidenceText = evidence.slice(0, 24).join("\n\n") || "(nenhuma evidência recuperada)";
  let validationResult: unknown = null;
  let reflection: Reflection | null = null;
  let confidence = 0.8;
  let tier: ConfidenceTier = "auto";

  // Contexto de risco alto: falhar o validador aqui nunca deve aprovar às cegas (ver validate.server.ts).
  const highRiskContext =
    plan.riskLevel === "high" ||
    intent.urgency === "high" ||
    intent.category === "acesso" ||
    intent.category === "reserva" ||
    intent.category === "financeiro";

  if (reply && !handoffReason) {
    const [validated, reflected] = await Promise.all([
      validateAnswer({
        question: params.message,
        answer: reply,
        evidence: evidenceText,
        language: intent.language,
        policies: context.behavior || undefined,
        highRisk: highRiskContext,
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
    reflection = reflected.reflection;

    // Melhoria da redação sugerida pela autoavaliação (sem fatos novos, segundo a reflection).
    // CORREÇÃO: o texto melhorado NUNCA foi checado pelo validador (que rodou em paralelo sobre o
    // texto original) — sem revalidar, o hóspede recebe um texto que passou pela IA duas vezes mas
    // pela checagem anti-alucinação zero. Se a reflection reescreveu o texto, revalidamos só a versão
    // final antes de decidir o que sai. Custo extra: uma chamada adicional, só quando há reescrita.
    let finalValidation = validated.validation;
    if (reflection.improvedAnswer && !reflection.needsHuman && validated.validation.approved) {
      const revalidated = await validateAnswer({
        question: params.message,
        answer: reflection.improvedAnswer,
        evidence: evidenceText,
        language: intent.language,
        policies: context.behavior || undefined,
        highRisk: highRiskContext,
      });
      usage = mergeUsage(usage, revalidated.usage);
      if (revalidated.validation.approved) {
        reply = reflection.improvedAnswer;
        finalValidation = revalidated.validation;
      }
      // Se a revalidação reprovar o texto melhorado, ficamos com o original (já validado) —
      // nunca descartamos a checagem, só a melhoria de redação.
    }
    validationResult = finalValidation;

    // 8) Confidence Threshold — calculado sobre o texto que de fato vai ser enviado.
    confidence = aggregateConfidence({
      validation: finalValidation.confidence,
      reflection: reflection.skipped ? null : reflection.score,
      sourceWeight: aggregateSourceWeight(sources),
      riskLevel: plan.riskLevel,
    });
    tier = tierFor(confidence, thresholds);

    const forcedHuman =
      (!finalValidation.approved && finalValidation.needsHuman) ||
      reflection.needsHuman ||
      plan.needsHuman;

    if (!params.explorationMode && (tier === "handoff" || forcedHuman)) {
      handoffReason =
        `Confiança insuficiente (${Math.round(confidence * 100)}%, nível=${tier}). ` +
        `${finalValidation.reason || reflection.issues.join("; ") || (plan.needsHuman ? "planejador sinalizou necessidade de humano" : "inconsistência")}. ` +
        `Pergunta: ${params.message.slice(0, 160)}`;
      handoffUrgency = intent.urgency === "high" ? "high" : "normal";
      reply = "";
      tier = "handoff";
    } else if (tier === "hedged" && !params.explorationMode) {
      reply = `${reply}${hedgeNotice(intent.language)}`;
    }
  } else if (handoffReason) {
    tier = "handoff";
    confidence = 1;
  }

  // 9) Persistência de memória + observabilidade (não bloqueiam a resposta)
  rememberMessage(params.conversationId, "assistant", reply);
  if (intent.category !== "operacional" && intent.urgency !== "high") {
    // pergunta resolvida fora de contexto operacional encerra o assunto em aberto
    if (!handoffReason) clearOpenTopic(params.conversationId);
  }

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

  // Política de gravação: só o que tem utilidade futura vira memória de longo prazo.
  void (async () => {
    try {
      const { candidates } = await classifyForMemory({
        message: params.message,
        answer: reply,
        category: intent.category,
        intent: intent.intent,
        language: intent.language,
      });
      if (candidates.length) {
        rememberEntities(params.conversationId, {
          ultimo_tema: candidates[0]?.title ?? candidates[0]?.content.slice(0, 80) ?? "",
        });
        await writeMemories({
          supabase,
          ownerId,
          propertyId,
          subjectKey: guestKey,
          guestName: params.guestName,
          sourceRef: params.conversationId,
          candidates,
        });
      }
    } catch (err) {
      console.error("[agent] gravação de memória falhou", err);
    }
  })();

  // Memória operacional: todo escalonamento vira chamado rastreável.
  if (handoffReason || intent.category === "operacional") {
    void recordOperationalRequest({
      supabase,
      ownerId,
      propertyId,
      conversationId: params.conversationId,
      guestKey,
      guestName: params.guestName,
      category: intent.category === "operacional" ? "manutencao" : (intent.category ?? "outro"),
      request: params.message.slice(0, 800),
      metadata: { intent: intent.intent, urgency: intent.urgency, handoff: !!handoffReason },
    }).catch(() => undefined);
  }

  // Knowledge Distillation: decisão humana usada agora vira candidata a conhecimento.
  if (humanAnswers.length) {
    void (async () => {
      for (const a of humanAnswers) {
        await learnFromHumanAnswer({
          supabase,
          ownerId,
          propertyId,
          propertyName: (property.title as string) ?? null,
          escalationId: a.id,
          agent: a.agent,
          question: a.question,
          humanAnswer: a.answer,
        }).catch(() => undefined);
      }
    })();
  }

  void logAgentRun(supabase, {
    ownerId,
    propertyId,
    conversationId: params.conversationId,
    surface: params.surface ?? "guide_chat",
    intent,
    contextKeys: [...context.keys, ...guestContext.keys],
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
    promptVersions: {
      ...stampVersions([
        "agent",
        "planner",
        "reflection",
        "supervisor",
        "validation",
        ...(params.explorationMode ? (["exploration"] as const) : []),
      ]),
      ...stampAgentPrompt(agent),
    },
    confidenceTier: tier,
    sourceWeight: aggregateSourceWeight(sources),
    memoryContextUsed: guestContext.memories.length > 0 || guestContext.operational.length > 0,
    memoriesRetrieved: guestContext.memories.map((m) => ({
      id: m.id,
      tier: m.tier,
      kind: m.kind,
      source: m.source,
      score: Number(m.score.toFixed(4)),
      decay: Number(m.decay.toFixed(4)),
      lastSeenAt: m.lastSeenAt,
    })),
    memoryConfidenceScore: guestContext.memoryConfidence,
    guestContextSnapshot: guestContext.guestSnapshot,
    operationalContextSnapshot: guestContext.operationalSnapshot,
    selectedAgent: agent.key,
    agentAutonomy: agent.autonomy,
    orchestratorDecision: describeRouting(routing),
    escalationTriggered: !!escalationId,
    escalationId,
    humanResponseUsed: humanAnswers.length > 0,
    tenantId: tenant.tenantId,
    channelOrigin: channel,
    channelReference: params.channelReference ?? null,
    proactiveTrigger: params.proactiveTrigger ?? null,
    autonomyLevel: params.autonomyLevel ?? agent.autonomy,
    actionApprovalStatus: handoffReason ? "waiting_human" : "not_required",
    rootCause: buildRootCause({
      decision: {
        agent: agent.key,
        routingReason: routing.reason,
        autonomy: agent.autonomy,
        confidence,
        confidenceTier: tier,
        handoff: !!handoffReason,
        handoffReason,
      },
      context: {
        keys: [...context.keys, ...guestContext.keys],
        memoryUsed: guestContext.memories.length > 0,
        humanAnswerUsed: humanAnswers.length > 0,
      },
      memories: guestContext.memories.map((m) => ({ id: m.id, tier: m.tier, score: m.score })),
      tools: toolsUsed.map((t) => ({ name: t.name, durationMs: t.durationMs })),
      sources: sources.map((s) => ({ source: s.source, confidence: s.confidence })),
      channel: { origin: channel, reference: params.channelReference ?? null },
      proactive: {
        trigger: params.proactiveTrigger ?? null,
        autonomyLevel: params.autonomyLevel ?? agent.autonomy,
        approvalStatus: handoffReason ? "waiting_human" : "not_required",
      },
    }),
  }).catch(() => undefined);

  // Enterprise Audit Trail — rastro estruturado da decisão desta interação.
  // Nunca gravamos chain-of-thought: apenas motivo, classificação e evidências.
  void (async () => {
    const { logSystemEvents } = await import("./audit/events.server");
    const correlationId = params.conversationId ?? null;
    const base = {
      tenantId: tenant.tenantId,
      actorType: "AI_AGENT" as const,
      actorId: agent.key,
      actorName: agent.key,
      actorRole: agent.autonomy,
      conversationId: params.conversationId ?? null,
      propertyId,
      channel,
      source: "ai_orchestrator",
      correlationId,
      eventCategory: "AI_DECISION" as const,
    };
    await logSystemEvents(supabase, [
      {
        ...base,
        eventType: "agent_selected",
        description: `Agente ${agent.key} assumiu o atendimento`,
        reason: routing.reason,
        metadata: { agent: agent.key, autonomy: agent.autonomy },
      },
      ...(guestContext.memories.length
        ? [
            {
              ...base,
              eventType: "memory_retrieved",
              description: `${guestContext.memories.length} memória(s) utilizada(s)`,
              reason: "Contexto recuperado por relevância semântica e temporal",
              metadata: {
                memories: guestContext.memories.map((m) => ({ id: m.id, tier: m.tier, score: m.score })),
              },
            },
          ]
        : []),
      ...toolsUsed.map((t) => ({
        ...base,
        eventType: "tool_called",
        description: `IA usou a ferramenta "${t.name}"${
          t.args ? ` — ${JSON.stringify(t.args).slice(0, 180)}` : ""
        }`,
        reason: "Coleta de dado necessário para responder",
        metadata: { tool: t.name, args: t.args ?? null, durationMs: t.durationMs ?? null },
      })),

      ...(sources.length
        ? [
            {
              ...base,
              eventType: "source_used",
              description: `${sources.length} fonte(s) consultada(s)`,
              reason: "Evidências utilizadas na resposta",
              metadata: { sources: sources.map((s) => ({ source: s.source, confidence: s.confidence })) },
            },
          ]
        : []),
      {
        ...base,
        eventType: "confidence_generated",
        description: `Confiança ${confidence ?? "n/d"} (${tier})`,
        reason: handoffReason ?? "Resposta dentro do limite de autonomia",
        severity: handoffReason ? ("warning" as const) : ("info" as const),
        result: handoffReason ? ("pending" as const) : ("success" as const),
        metadata: { confidence, tier, handoff: !!handoffReason },
      },
      ...(reflection
        ? [
            {
              ...base,
              eventType: "reflection_completed",
              description: "Autoavaliação concluída",
              reason: "Reflection Step aplicado antes de responder",
              metadata: { reflection: reflection as never },
            },
          ]
        : []),
    ]);
  })().catch(() => undefined);


  // Continuous Learning: memórias usadas ganham/perdem peso conforme o desfecho
  // imediato desta resposta (o loop completo roda no cron, fora do caminho crítico).
  if (guestContext.memories.length) {
    void bumpMemoryUsage({
      supabase,
      memoryIds: guestContext.memories.map((m) => m.id),
      outcome: handoffReason ? "failure" : tier === "auto" ? "success" : "neutral",
    }).catch(() => undefined);
  }

  // Channel Gateway: registra (idempotente) a origem desta conversa.
  void bindConversationChannel({
    supabase,
    tenant,
    conversationId: params.conversationId,
    channel,
    externalReference: params.channelReference ?? null,
    locale: intent.language,
    metadata: { surface: params.surface ?? "guide_chat" },
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
    routing,
    escalationId,
    tenantId: tenant.tenantId,
    channel,
    toolsUsed,
    sourcesUsed: [...new Set(sources.map((s) => s.source))],
  };
}

