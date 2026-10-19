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
import { GUEST_DATA_BOUNDARY } from "./guest-data-boundary";
import { ensureGreeting } from "@/lib/ai/greeting";
import { SILENCE_TOKEN, finalizeAgentReply } from "@/lib/ai/reply-finalize";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMPTY_USAGE, chatText, mergeUsage, runAgent, type Usage } from "./gateway.server";
import { classifyIntent, type Intent } from "./intent.server";
import { buildAgentContext } from "./context.server";
import { hybridRetrieve, renderPassages } from "./rag.server";
import { buildGuestTools, type ToolContext } from "./tools.server";
import { validateAnswer } from "./validate.server";
import { suggestQuickReplies } from "./quick-replies.server";
import { guestKeyOf, loadGuestMemoryWithFallback, reservationCodeFromDossier, updateGuestMemory } from "./memory.server";
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
import { PROMPTS, stampVersions } from "./prompts";
import { continuityLine } from "./continuity";
import { acknowledgementReply, humanSupportReply, isOnlyGreeting, stripPromiseSentences } from "./human-support";
import { buildHandoffDraft, formatDraftForTeam } from "./human-loop/handoff-draft.server";
import { accessGuidanceText, accessTiming, decideAccess } from "./access-guidance.server";
import { decideReservationRequest, detectReservationRequest, reservationRequestGuidance } from "./reservation-change";
import { loadCancellationWindow } from "./reservation-policy.server";
import { applyVoiceRules, humanityMetrics, readGuestVoice, toneLint, rewritePreserves, voiceGuidance } from "./voice";
import { makeTranslatable, translatableGuidance } from "./translatable";
import { matchPlaybook, playbookText } from "./playbooks";
import { matchPropertyPlaybooks, propertyPlaybookText, type PropertyPlaybook } from "./learning/property-playbooks";
import { planExecution, type ExecutionPlan } from "./planner.server";
import { reflectOnAnswer, type Reflection } from "./reflection.server";
import { aggregateSourceWeight, confidenceOf, renderSourceRanking } from "./sources";
import {
  aggregateConfidence,
  handoffFallback,
  hedgeNotice,
  isSensitiveContext,
  thresholdsFor,
  tierFor,
  type ConfidenceTier,
} from "./confidence";
import {
  allowedToolsOf,
  getAgent,
  renderAgentBriefing,
  stampAgentPrompt,
} from "./agents/registry.server";
import { describeRouting, routeToAgent } from "./agents/supervisor.server";
import { buildAgentTools } from "./agents/tools.server";
import type { AgentRouting } from "./agents/types";
import { reasoningFor, maxStepsFor } from "./reasoning";
import {
  askHumanSupervisor,
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
import { claimsRemoteAction, guestSafetyDecision } from "./guest-safety.server";
import { maskDigitSequences } from "@/lib/guest-access.server";
import { resolveStayAccess, stayFactsText } from "./stay-access.server";

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
  /** Opções curtas de resposta rápida (botões) — [] quando a resposta não é
   * uma pergunta de múltipla escolha. O hóspede sempre pode digitar livre. */
  quickReplies: string[];
};

/**
 * Pedido explícito de humano — único gatilho que sempre aciona a consulta
 * interna, em qualquer tema. (A IA continua respondendo: escalar é sobre quem
 * DECIDE, não sobre quem fala. Ver o bloco de handoff mais abaixo.)
 *
 * `tem alguém aí` foi RETIRADO em 11/09/2026. Ele casava com a pergunta mais
 * comum de quem só quer saber se o chat está vivo — "oi, tem alguém aí?" — e
 * transformava uma saudação em escalonamento. Nos logs dos últimos 14 dias há
 * um handoff cujo motivo registrado é, literalmente, "o hóspede enviou apenas
 * uma saudação inicial sem uma solicitação específica". As outras alternativas
 * já cobrem o pedido de verdade ("falar com alguém", "quero um atendente",
 * "chamar o responsável", "me transfere", "atendimento humano").
 *
 * E o ARTIGO passou a ser previsto. A expressão exigia "falar com" colado no
 * substantivo, então a forma mais natural em português — "quero falar com O
 * anfitrião", "queria falar com A responsável" — simplesmente não casava. O
 * gatilho de pedido explícito perdia metade dos pedidos explícitos, calado,
 * desde sempre. Encontrado pelo teste desta mesma entrega.
 */
export const EXPLICIT_HUMAN_REQUEST =
  /\b(?:falar|conversar|conversa)\s+com\s+(?:o|a|os|as|um|uma)?\s*(?:algu[eé]m|pessoa|humano|atendente|anfitri[ãa]o|propriet[áa]ri[oa]|respons[áa]vel|gerente|suporte)|quero\s+(?:um\s+|uma\s+|o\s+|a\s+)?(?:humano|atendente|anfitri[ãa]o|respons[áa]vel)|chama(?:r)?\s+(?:o\s+|a\s+)?(?:anfitri[ãa]o|respons[áa]vel|algu[eé]m)|me\s+transfere|atendimento\s+humano/i;

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
  /** Datas da reserva — usadas para vincular o roteiro (itinerário) à
   * RESERVA, não ao hóspede individual: mais de uma pessoa pode estar
   * conversando sobre a mesma reserva (casal, cada um pelo próprio
   * celular), e todos precisam ver o mesmo roteiro compartilhado. */
  checkinDate?: string | null;
  checkoutDate?: string | null;
  /** Consulta/pedido de reserva da plataforma (datas e hóspedes já informados). */
  bookingRequest?: {
    checkin: string;
    checkout: string;
    nights: number | null;
    guests: number | null;
    stage: string;
  } | null;
  /** Progresso em tempo real do pipeline (streaming para a UI do hóspede). */
  onStage?: (stage: { step: string; label: string }) => void;
  /**
   * Rascunho da resposta enquanto o modelo escreve (30/09/2026). Só é usado
   * quando as senhas NÃO estão travadas; a resposta validada chega no fim e
   * substitui o rascunho.
   */
  onDraft?: (text: string) => void;
  /**
   * Trava as senhas/códigos do imóvel para ESTA conversa, mesmo sem PIN de
   * visualização configurado (16/09/2026). O chat do guia liga isto quando o
   * visitante não provou a reserva — antes, qualquer pessoa com o link (ou a
   * vitrine da landing) recebia o código da fechadura pela IA.
   */
  credentialsLocked?: boolean;
  /**
   * Reserva confirmada e ativa validada pelo canal. Sem ela, dados sensíveis
   * do imóvel (endereço exato, número, senhas, códigos, Wi-Fi, contatos
   * internos) NUNCA são revelados — regra para todos os canais.
   */
  reservationVerified?: boolean;
  /** Código da reserva desta conversa (chave da memória). Opcional: sai do dossiê se faltar. */
  reservationCode?: string | null;
  /** Dossiê completo da reserva oficial (código, ocupação, valores, taxas, cancelamento). */
  reservationDossier?: string | null;
}): Promise<OrchestratorResult> {
  const started = Date.now();
  const { supabase, property } = params;
  // Economia de contexto: pergunta objetiva (ex.: senha do Wi-Fi) dispensa o
  // histórico; dúvida contínua sempre lê o histórico antes de responder.
  const fullHistory = params.history ?? [];
  {
    const { needsHistory } = await import("@/lib/ai/history-need");
    if (!needsHistory(params.message)) params = { ...params, history: [] };
  }
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
  const {
    intent,
    usage: intentUsage,
    model: intentModel,
  } = await classifyIntent(params.message, params.history);
  usage = mergeUsage(usage, intentUsage);
  models.intent = intentModel;
  // Idioma por canal: Airbnb/OTAs e Guia Digital já traduzem para o hóspede,
  // então a IA responde sempre em português; só o WhatsApp (sem tradução
  // nativa) segue o idioma em que o hóspede escreveu.
  const guestLanguage = intent.language;
  const replyInGuestLanguage = channel === "whatsapp";
  if (!replyInGuestLanguage) (intent as { language: string }).language = "pt";

  // O "modo exploração" (mandato forte de só citar lugares vindos de
  // list_recommendations/search_places) até aqui só ligava por um sinal
  // "sticky" olhando o histórico — ou seja, a PRIMEIRA pergunta de recomendação
  // de uma conversa nova nunca ativava, e o especialista respondia sem o
  // mandato explícito de ferramenta, abrindo espaço para citar lugares de
  // memória geral do modelo (exatamente o que a validação anti-alucinação
  // pegou). Agora também ativa quando a classificação de intenção — que já
  // roda de qualquer forma, no primeiro turno — identifica a pergunta como
  // sobre a cidade ou pedido de recomendação.
  const explorationMode =
    params.explorationMode === true ||
    intent.category === "cidade" ||
    intent.category === "recomendacao";

  // Memória por RESERVA: o código vem do chamador ou do dossiê oficial.
  const reservationCode = params.reservationCode ?? reservationCodeFromDossier(params.reservationDossier);
  const guestKey = guestKeyOf(params.sessionId, params.guestName, reservationCode);
  const legacyGuestKey = guestKeyOf(params.sessionId, params.guestName);
  rememberMessage(params.conversationId, "user", params.message);
  rememberIntent(params.conversationId, intent);

  // Mente única de acesso: estadia em andamento (e não "Não Compareceu")
  // libera todos os dados do anúncio em qualquer canal.
  const stayAccess = await resolveStayAccess({
    supabase,
    property,
    channel,
    guestName: params.guestName,
    checkinDate: params.checkinDate,
    checkoutDate: params.checkoutDate,
    reservationVerified: params.reservationVerified,
    credentialsLocked: params.credentialsLocked,
  }).catch((e) => {
    console.error("[agent] resolveStayAccess falhou", e);
    return { open: false } as { open: boolean };
  });

  // REGRAS DE ACESSO (17/10/2026): ver `decideAccess`. Nos casos em que a IA
  // precisa consultar a equipe antes de entregar, as credenciais nem chegam ao
  // modelo (fail-closed) até a equipe responder na conversa ou antecipar a
  // previsão no painel.
  const accessTimingInfo = stayAccess.open
    ? await accessTiming({
        supabase,
        property: property as Record<string, unknown>,
        checkin: (stayAccess as { checkin?: string | null }).checkin,
        checkout: (stayAccess as { checkout?: string | null }).checkout,
        agreedCheckout: (stayAccess as { agreedCheckout?: string | null }).agreedCheckout,
      })
    : null;
  // Pedido sobre a reserva (estender, "por fora", cancelar, reduzir, mudar período):
  // o código decide a rota (plataforma / recusa gentil / equipe); o modelo só comunica.
  const reservationRequestKind = detectReservationRequest(params.message);
  let reservationRequestText = "";
  if (reservationRequestKind) {
    const needsWindow = !["extend", "outside_booking"].includes(reservationRequestKind);
    const window = needsWindow
      ? await loadCancellationWindow(supabase as never, {
          propertyId,
          code: reservationCode ?? null,
          checkin: (stayAccess as { checkin?: string | null }).checkin,
          checkout: (stayAccess as { checkout?: string | null }).checkout,
        })
      : null;
    reservationRequestText = reservationRequestGuidance(
      decideReservationRequest({ kind: reservationRequestKind, window }),
      stayAccess.open || params.reservationVerified === true,
    );
  }
  const teamAnswersForAccess =
    stayAccess.open && params.conversationId
      ? await pendingHumanAnswers({ supabase, conversationId: params.conversationId }).catch(() => [])
      : [];
  const accessMode = stayAccess.open
    ? decideAccess({
        isCheckinDay: !!accessTimingInfo?.isCheckinDay,
        early: !!accessTimingInfo?.early,
        released: (stayAccess as { released?: boolean }).released !== false,
        hasTeamAnswer: teamAnswersForAccess.length > 0,
      })
    : "deliver";

  // Guardrail determinístico: acesso físico e credenciais não dependem de decisão do modelo.
  const safety = await guestSafetyDecision(params.message, String(property.slug ?? ""), {
    supabase,
    propertyId,
    stayOpen: stayAccess.open,
  });
  // MODO CONVERSACIONAL de incidente de acesso (17/10/2026): com a estadia
  // aberta, a IA conversa e conduz a entrada passo a passo (a equipe é acionada
  // em paralelo). O roteiro fixo continua valendo quando a estadia NÃO está
  // aberta (hóspede não verificado / fora da janela). Em ambos os casos o filtro
  // determinístico `claimsRemoteAction` barra alegação de ação remota.
  const conversationalIncident = safety.kind === "access_incident" && stayAccess.open === true;
  if (conversationalIncident) {
    handoffReason = "Incidente de acesso físico relatado pelo hóspede.";
    handoffUrgency = "high";
    void recordOperationalRequest({
      supabase,
      ownerId,
      propertyId,
      conversationId: params.conversationId,
      guestKey,
      guestName: params.guestName,
      category: "acesso",
      request: params.message.slice(0, 800),
      metadata: { intent: intent.intent, urgency: "high", handoff: true, source: "access_incident_conversational" },
    }).catch(() => undefined);
  }
  if (safety.kind !== "none" && !conversationalIncident) {
    const handoff = safety.kind === "access_incident";
    const plan: ExecutionPlan = {
      objective:
        safety.kind === "access_incident"
          ? "Proteger o hóspede em incidente de acesso"
          : "Orientar o acesso seguro ao guia",
      tools: handoff
        ? [{ name: "request_human_handoff", reason: "incidente de acesso físico" }]
        : [],
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
        metadata: {
          intent: intent.intent,
          urgency: "high",
          handoff: true,
          source: "deterministic_guest_safety",
        },
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
      quickReplies: [],
    };
  }

  stage("memory", "Lembrando do seu histórico");
  // 2) Guest Context Engine + Memory Retrieval (curto prazo, longo prazo, operacional)
  const memory = await loadGuestMemoryWithFallback(supabase, propertyId, guestKey, legacyGuestKey);
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
    language: guestLanguage,
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

  stage("plan", "Montando o plano de resposta");
  // 2b) Supervisor Agent + 3) Planner Agent — rodam em paralelo: nenhum dos dois
  // depende do resultado do outro, só de `intent`/`guestContext`. Antes rodavam em
  // série (mais um round-trip de LLM por mensagem, sem necessidade).
  const [
    { routing, usage: routeUsage, model: supervisorModel },
    { plan, usage: planUsage, model: plannerModel },
    context,
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
      explorationMode,
      contextHint: guestContext.text.slice(0, 2500),
    }),
    // Contexto da residência é só leitura de banco: rodava em série depois do
    // supervisor/planejador e somava latência à toa em toda mensagem.
    buildAgentContext({
      supabase,
      property,
      guestName: params.guestName,
      memory,
    }),
  ]);
  usage = mergeUsage(usage, routeUsage);
  if (supervisorModel) models.supervisor = supervisorModel;
  const agent = getAgent(routing.agent);
  usage = mergeUsage(usage, planUsage);
  if (plannerModel) models.planner = plannerModel;
  rememberPlan(params.conversationId, plan);


  stage("retrieval", "Consultando o guia da residência");
  // 4) Pré-recuperação Hybrid RAG (indexa sob demanda na primeira vez)
  /* BASE VELHA = BASE AUSENTE (25/09/2026).
   * Antes só indexava quando não havia nenhum trecho. Uma base antiga ficava
   * para sempre: a IA lia instruções de agosto, contradizia o guia atual e o
   * validador chamava humano. Agora compara a data da base com a última edição
   * do guia (imóvel, manual e recomendações) e reindexa se estiver atrás. */
  const [chunkRes, propRes, manRes, recRes] = await Promise.all([
    supabase.from("ai_kb_chunks").select("updated_at").eq("property_id", propertyId).order("updated_at", { ascending: false }).limit(1),
    supabase.from("properties").select("updated_at").eq("id", propertyId).maybeSingle(),
    supabase.from("property_manual_items").select("created_at").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(1),
    supabase.from("property_recommendations").select("created_at").eq("property_id", propertyId).order("created_at", { ascending: false }).limit(1),
  ]);
  const ts = (v: unknown) => (typeof v === "string" ? Date.parse(v) || 0 : 0);
  const indexedAt = ts((chunkRes.data?.[0] as { updated_at?: string } | undefined)?.updated_at);
  const editedAt = Math.max(
    ts((propRes.data as { updated_at?: string } | null)?.updated_at),
    ts((manRes.data?.[0] as { created_at?: string } | undefined)?.created_at),
    ts((recRes.data?.[0] as { created_at?: string } | undefined)?.created_at),
  );
  if (!indexedAt || editedAt > indexedAt + 60_000) {
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

  // Reserva confirmada e ativa: o canal informa; sem informação, só vale a
  // reserva vinculada fora do Airbnb e com estadia ainda não encerrada.
  const reservationVerified =
    stayAccess.open ||
    (params.reservationVerified ??
      (channel !== "airbnb" &&
        context.keys.includes("reservation") &&
        context.stayPhase !== "post_checkout" &&
        context.stayPhase !== "unknown"));
  const credentialsLocked = stayAccess.open
    ? false
    : context.sensitiveLocked || params.credentialsLocked === true || !reservationVerified;
  const stayFacts = stayAccess.open ? stayFactsText(property as Record<string, unknown>) : "";
  if (stayFacts) {
    sources.push({ source: "property", title: "Dados da residência (estadia em andamento)", confidence: confidenceOf("property") });
    evidence.push(`[property] Dados oficiais do anúncio liberados durante a estadia:\n${stayFacts}`);
  }
  const retrieved = await hybridRetrieve({
    supabase,
    ownerId,
    propertyId,
    query: intent.searchQuery || params.message,
  });
  const { usage: ragUsage, retrievalUsed } = retrieved;
  // Com as senhas travadas, nenhuma sequência numérica do guia chega ao
  // modelo pelo RAG — mesma máscara de `get_property_facts`.
  const passages = credentialsLocked
    ? retrieved.passages.map((p) => ({
        ...p,
        content: maskDigitSequences(String(p.content ?? "")),
      }))
    : retrieved.passages;
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
        const scoped = rows
          .filter((r) => !r.property_id || r.property_id === propertyId)
          .slice(0, 20);
        if (!scoped.length) return "";
        return scoped
          .map(
            (r) =>
              `- [${r.category ?? "geral"}] ${r.title}: ${String(r.content ?? "").slice(0, 500)}`,
          )
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
    sources.push({
      source: "global_intelligence",
      title: g.title,
      confidence: confidenceOf("global_intelligence"),
    });
    evidence.push(`[global_intelligence] ${g.title}: ${g.content}`);
  }

  stage("agent", "Preparando a melhor resposta");
  // 5) Agente especialista com ferramentas (whitelist do registry)
  let escalationId: string | null = null;
  let escalationQuestion: string | null = null;

  // Chave do roteiro: só vira compartilhada por RESERVA quando TODAS as
  // pessoas já vinculadas a ela votaram por tratar em grupo (consenso
  // explícito, nunca forçado) — ver reservation-mode.server.ts. Sem
  // consenso, cada hóspede continua com seu próprio roteiro isolado.
  let reservationKey = guestKey;
  let reservationModeContext = "";
  if (params.checkinDate && params.checkoutDate && params.guestName) {
    try {
      const { getReservationMode } = await import("./reservation-mode.server");
      const modeInfo = await getReservationMode({
        supabase,
        propertyId,
        checkinDate: params.checkinDate,
        checkoutDate: params.checkoutDate,
        currentGuestName: params.guestName,
      });
      if (modeInfo.mode === "group") {
        reservationKey = `${params.checkinDate}::${params.checkoutDate}`;
      }
      if (modeInfo.otherGuestNames.length > 0 && modeInfo.currentGuestHasNotVoted) {
        reservationModeContext =
          `\n\n[Outra(s) pessoa(s) também vinculada(s) a esta mesma reserva: ${modeInfo.otherGuestNames.join(", ")}. ` +
          `Você ainda não perguntou se preferem tratar assuntos (como o roteiro da viagem) em conjunto ou ` +
          `separadamente — pergunte isso de forma natural, uma única vez, na próxima resposta relevante ` +
          `(não precisa ser a primeira coisa da conversa). Use set_reservation_mode para registrar a resposta.]`;
      }
    } catch (e) {
      console.error("[orchestrator] getReservationMode falhou", e);
    }
  }

  const toolCtx: ToolContext = {
    supabase,
    ownerId,
    propertyId,
    property,
    conversationId: params.conversationId,
    guestName: params.guestName,
    guestKey,
    reservationKey,
    checkinDate: params.checkinDate ?? null,
    checkoutDate: params.checkoutDate ?? null,
    sensitiveLocked: credentialsLocked,
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

  // Voz do hóspede (registro, emoji, risada) e orientação de acesso por horário.
  const guestVoice = readGuestVoice(params.history ?? [], params.message);
  const voiceNegative = intent.sentiment === "negativo" || intent.category === "operacional" || conversationalIncident;
  const playbook = matchPlaybook(
    params.message,
    (params.history ?? []).filter((m) => m.role === "user").map((m) => m.content),
  );
  // Playbooks APRENDIDOS deste imóvel (cérebro contínuo): o que a equipe já resolveu aqui.
  let learnedPlaybooks: PropertyPlaybook[] = [];
  try {
    const { loadPropertyPlaybooks } = await import("./learning/property-playbooks.server");
    const { markPlaybooksUsed } = await import("./learning/property-playbooks.server");
    learnedPlaybooks = matchPropertyPlaybooks(
      await loadPropertyPlaybooks(supabase, propertyId),
      params.message,
      (params.history ?? []).filter((m) => m.role === "user").map((m) => m.content),
    );
    if (learnedPlaybooks.length) void markPlaybooksUsed(supabase, learnedPlaybooks.map((p) => p.id));
  } catch (e) {
    console.error("[agent] playbooks do imóvel indisponíveis", e);
  }
  const accessGuidance = stayAccess.open ? accessGuidanceText(accessTimingInfo, conversationalIncident, accessMode) : "";

  const instructions =
    PROMPTS.agent.text +
    (explorationMode ? PROMPTS.exploration.text : "") +
    `\n\n=== SEU PAPEL NESTA CONVERSA ===\n${renderAgentBriefing(agent)}` +
    (context.behavior
      ? `\n\nCOMPORTAMENTO DEFINIDO PELO ANFITRIÃO (prioridade máxima, siga estritamente)\n${context.behavior}`
      : "") +
    (tenantKnowledgeText
      ? `\n\nCONHECIMENTO DA EMPRESA (políticas/procedimentos internos cadastrados pelo anfitrião — trate como regra oficial, não como sugestão)\n${tenantKnowledgeText}`
      : "") +
    `\n\nRANKING PERMANENTE DE FONTES (em conflito, o tier menor sempre vence)\n${renderSourceRanking()}` +
    `\n\nCONTEXTO ATUAL\n${context.text}` +
    (params.reservationDossier
      ? `\n\n## RESERVA OFICIAL DESTE HÓSPEDE (fonte autoritativa, prevalece sobre qualquer outra)\n${params.reservationDossier}\n- Use estes dados (código, datas, hóspedes, valores, taxas, pagamento, cancelamento) para responder com precisão, sem perguntar o que já está aqui.\n- Valores e política: informe quando o hóspede perguntar; cancelamento/alteração seguem a regra de AUTONOMIA DA RESERVA.`
      : "") +
    `\n\nCONTEXTO DO HÓSPEDE E MEMÓRIA (uso interno — nunca revele ao hóspede que existe histórico registrado)\n${guestContext.text}` +
    reservationModeContext +
    renderHumanAnswers(humanAnswers) +
    (replyInGuestLanguage
      ? `\n\nIDIOMA PROVÁVEL DA MENSAGEM: ${guestLanguage} (responda no idioma em que o hóspede escreveu)`
      : `\n\nIDIOMA DE RESPOSTA (obrigatório): responda SEMPRE em português do Brasil, mesmo que o hóspede escreva em outro idioma (${guestLanguage}). Este canal traduz automaticamente para o hóspede.`) +
    (stayAccess.open
      ? `\n\nESTADIA EM ANDAMENTO — TODOS OS DADOS DO ANÚNCIO LIBERADOS (prioridade máxima; anula qualquer regra acima que mande bloquear senhas/códigos ou enviar o hóspede ao guia)\n- O hóspede tem reserva confirmada e está dentro do período da estadia.\n- Quando ele pedir, informe DIRETAMENTE e por completo: rede e senha do Wi-Fi, códigos de portão/fechadura/cofre, endereço e instruções de acesso, exatamente como estão abaixo. Nunca diga para abrir o guia ou "Ver senhas e códigos" para obter esses dados.\n- Não invente nada que não esteja aqui.\n${stayFacts}`
      : "") +
    (reservationVerified
      ? ""
      : `\n\nRESERVA NÃO CONFIRMADA — DADOS SENSÍVEIS BLOQUEADOS (prioridade máxima, vale para qualquer canal)\n- Não há reserva confirmada e ativa validada para esta pessoa.\n- NUNCA informe endereço exato (rua com número, complemento, CEP), link/pin de localização do imóvel, senhas, códigos de portão/fechadura, Wi-Fi, instruções de acesso ou contatos internos.\n- Pode citar apenas bairro, região e distâncias/referências próximas.\n- Se pedirem esses dados, explique com gentileza que o endereço completo e as informações de acesso são enviados assim que a reserva estiver confirmada.`) +
    (params.bookingRequest && !reservationVerified
      ? `\n\nCONSULTA PRÉ-RESERVA JÁ INFORMADA PELO HÓSPEDE NA PLATAFORMA (${params.bookingRequest.stage === "reservation_request" ? "pedido de reserva aguardando aprovação" : "consulta, ainda não reservado"})\n- Chegada: ${params.bookingRequest.checkin}\n- Saída: ${params.bookingRequest.checkout}${params.bookingRequest.nights ? ` (${params.bookingRequest.nights} noites)` : ""}${params.bookingRequest.guests ? `\n- Hóspedes: ${params.bookingRequest.guests}` : ""}\n- PROIBIDO perguntar datas de chegada/saída, número de noites ou de hóspedes: use estes dados diretamente (ex.: dia da semana da chegada).`
      : "") +
    (!reservationVerified
      ? `\n\nFECHAMENTO PRÉ-RESERVA (estilo obrigatório)\n- Responda primeiro à dúvida com precisão.\n- Termine com UMA frase curta, neutra e direta conduzindo à reserva, variando a cada mensagem. Exemplos de tom: "Vamos seguir com a reserva?", "Lembre-se de que os valores só ficam garantidos após a reserva confirmada, ok?", "Não prefere já garantir sua reserva para não correr o risco de outra pessoa reservar essas datas?".\n- PROIBIDO tom meloso ou bajulador ("será um prazer imenso", "ficaremos encantados", "prontinha para acolher vocês"), exclamações em excesso ou pressão insistente.\n- Não repita o convite se a mensagem anterior da conversa já terminou com um.\n\nRETENÇÃO (obrigatório)\n- PROIBIDO sugerir outra hospedagem, outro anúncio que não seja nosso, ou dar dicas de como reservar em outro lugar.\n- Se o hóspede exigir garantia que não podemos dar (ex.: entrada de manhã cedo), ofereça objetivamente a alternativa nossa: reservar também a noite anterior garante a unidade livre na chegada.\n- Se ele decidir não reservar: uma frase curta e sóbria (ex.: "Entendido, Cauane. Boa viagem!"). Sem "estamos sempre à disposição", "portas abertas" ou similares.\n- Nunca repita informação que já enviou nesta conversa.`
      : "") +
    (stayAccess.open ? accessGuidance : "") +
    reservationRequestText +
    GUEST_DATA_BOUNDARY +
    (playbook ? playbookText(playbook) : "") +
    propertyPlaybookText(learnedPlaybooks) +
    (replyInGuestLanguage ? "" : translatableGuidance()) +
    `\n\nVOZ E ADAPTAÇÃO AO HÓSPEDE (obrigatório)\n${voiceGuidance(guestVoice, voiceNegative)}` +
    `\n\nANTI-REPETIÇÃO (obrigatório)\n- Leia suas mensagens anteriores nesta conversa antes de responder.\n- Nunca repita saudação, abertura, frase de fechamento ou informação já dada; se precisar retomar algo, resuma em poucas palavras.\n- Não cumprimente de novo se já cumprimentou nesta conversa.\n- Varie estrutura e vocabulário; nada de frases-modelo recorrentes.` +
    `\n\nHIERARQUIA DE FONTES (sem conflito, nesta ordem)\n1. Anúncio do Airbnb (fonte airbnb_listing): é a verdade. Se a informação está lá, vale o anúncio, mesmo que outra fonte diga diferente.\n2. Não está no anúncio: o complemento é o sistema ConciergeIA como um todo (cadastro do imóvel, FAQ, regras, procedimentos, memória operacional e, se existir, o guia — que é só mais um desses locais). Ex.: número da vaga de garagem, eletrodoméstico não listado nas comodidades. Procure até encontrar e responda direto, sem mandar o hóspede abrir nada.\n3. Informação pública (distâncias, tempo de trajeto, bairros, pontos da cidade): use as referências da cidade e fontes públicas confiáveis (ex.: Google Maps). Na falta de dado confiável, diga que não tem certeza em vez de estimar.\n\nO QUE NUNCA SAI DO SISTEMA PARA O HÓSPEDE\n- Fale única e exclusivamente sobre o imóvel e a estadia (acesso, comodidades, regras da casa, cidade, recomendações). Jamais revele dados financeiros (valores de repasse, comissões, custos, faturamento, pagamentos à equipe), notas internas, observações da equipe, dados de outros hóspedes ou de proprietários, nem conversas operacionais. Se perguntarem, diga com naturalidade que não pode ajudar com isso pelo chat.\n\nENTRADA/SAÍDA AUTÔNOMA\n- Se o acesso é autônomo (cofre, fechadura eletrônica, senha, portaria), NUNCA peça aviso de trajeto, \"me avise 1 hora antes\" ou atualizações de chegada. Peça apenas que o hóspede confirme quando estiver dentro do imóvel (e, na saída, quando tiver deixado o imóvel).\n\nQUANDO NÃO RESPONDER (silêncio inteligente — exceção rara)\n- Responda exatamente ${SILENCE_TOKEN} (e nada mais) SOMENTE quando TODO o bloco de mensagens do hóspede for confirmação mecânica isolada, sem nenhuma informação nova (ex.: apenas "Ok", "Recebido", "Show").\n- NUNCA silencie "deu certo", "deeu", "abriu", "entramos", "acessei", "conseguimos": se confirma uma etapa intermediária da entrada (ex.: só o cofre do portão), entregue o próximo passo oficial; se o hóspede já está dentro ou era a última etapa, responda com o encerramento de ENTRADA CONCLUÍDA ("Maravilha, [nome]! ... Excelente estadia! 💜").\n- Se o bloco trouxer qualquer conteúdo além disso (planos, horário de chegada, trajeto, comentário, pergunta, sentimento), responda ao bloco inteiro normalmente. Conversa natural nunca fica sem resposta.\n\nCONVERSA CONTÍNUA E PROPOSITIVA (com cuidado)\n- Seja cordial, gentil e natural, como um coanfitrião atento; sem exageros, sem melação, sem excesso de exclamações.\n- Quando o hóspede abrir espaço (conta da viagem, chegada tarde, primeira vez na cidade, pergunta o que fazer), você pode propor UMA sugestão útil e confiável relacionada ao que ele disse (ex.: viagem longa e chegada à noite → boa viagem, lembrar que a entrada é autônoma e, se houver na base, uma opção de jantar perto aberta à noite).\n- Sem abertura do hóspede, não ofereça sugestões. Nunca invente lugares, horários ou distâncias: só o que estiver na base ou em fonte confiável.\n\nFORMATO (sempre organizado)\n- Nunca um bloco único de texto. Primeira frase responde direto; depois parágrafos curtos (1-2 frases) separados por linha em branco; itens/passos em lista. Resposta de uma frase só continua curta.\n\nFECHAMENTO CORDIAL\n- Agradecimento, elogio, votos ou despedida que chegam ANTES de você ter se despedido recebem resposta curta e calorosa, 1 a 2 frases, com o primeiro nome quando souber, sem melação (nada de \"estamos sempre à disposição\", \"portas abertas\"). Ex.: \"Imagina, Dayane! Tenha uma excelente noite.\"\n- FIM DE CICLO (silêncio obrigatório): se a SUA última mensagem já foi uma despedida/voto (boa noite, bom descanso, ótima estadia, boa viagem, aproveitem, excelente estadia) e o hóspede apenas retribui, agradece ou reage sem pergunta nem informação nova (\"Obrigada boa noite\", \"Valeu!\", \"Boa noite\", \"Igualmente\", emoji), responda exatamente ${SILENCE_TOKEN}. A conversa já terminou bem; não existe última palavra obrigatória.\n\nTOM HUMANO E ESPONTÂNEO\n- Fale como um anfitrião de verdade, não como SAC. Em momentos leves ou de celebração (elogio ao imóvel, empolgação, piada), pode devolver uma risada leve e natural SOMENTE se o hóspede riu ou brincou antes (ex.: \"Haha, que bom!\"). Uma risada só, nunca repetida nas últimas falas, nunca em problemas ou reclamações, nunca gíria.\n- ANTI-REPETIÇÃO: nunca repita nas mensagens seguidas as mesmas palavras, cumprimentos, votos, estrutura de frase ou emoji. Se já desejou \"ótima noite\", não deseje de novo. O 💜 é opcional e no máximo uma vez a cada várias mensagens. Varie a abertura (não comece sempre com \"Que bom\" ou o nome).\n- Reações a elogios são curtas (1 frase), sem reexplicar nada e sem perguntas.\n- Não repita informações já dadas nem faça novas perguntas no fechamento.\n- Afirmações que relatam problema ou necessidade ("Cheguei e não acho a chave", "O ar não gela", "O link não abre") NÃO são silêncio: responda e ajude.\n\nTRIAGEM ANTES DE ESCALAR\n- Problema prático: acolha em uma frase, consulte a base do imóvel e, se faltar algo, faça UMA pergunta curta de diagnóstico antes de pedir ajuda humana; ao escalar, descreva o diagnóstico no motivo.\n- Reclamação grave, conflito, ameaça de avaliação ruim ou cobrança agressiva: uma frase neutra de acolhimento (sem debater nem se justificar) e acione atendimento humano imediatamente.\n\nAUTONOMIA DA RESERVA (fale sempre no plural: nós, nossa equipe)\n- Estender a estadia ou reservar "por fora": oriente sempre o caminho pela plataforma (detalhes da reserva, se há reserva confirmada; confirmar a reserva, se não há). Nunca feche por fora. Para estender, verifique a disponibilidade. PROIBIDO frases como "temos total interesse".\n- Cancelar, reduzir ou mudar período: siga o bloco PEDIDO SOBRE A RESERVA (decidido pelo sistema pela modalidade e pelo prazo). Prazo sem multa vencido: sem autorização por causa da modalidade, suporte da plataforma se insistir, sem acionar a equipe. Dentro do prazo confirmado: equipe. Modalidade da reserva não confirmada: não decida; oriente o menu da reserva na plataforma. Sem o bloco, não decida nada sozinha.\n\nMENSAGENS AUTOMÁTICAS DO ANFITRIÃO\n- O histórico pode conter mensagens programadas já enviadas ao hóspede (boas-vindas, link do guia, código da reserva). Leia-as antes de responder: se o hóspede comentar ou perguntar sobre elas, baseie-se exatamente no que foi enviado.\n- Nunca escreva assinatura no fim da mensagem.\n\nSEM MELAÇÃO\n- Nunca justifique a demora ou a cautela com frases como "Prefiro te dar a resposta certa a uma rápida", "Não quero te responder por cima" ou "para não te passar nada errado". Só use esse tipo de fala se o hóspede tiver cobrado rapidez (ex.: "não consegue me dizer agora?"). Nunca prometa ação sua nem prazo ("vou verificar e já te respondo", "estou checando agora"): se depende de humano, acione a equipe (request_human_handoff); o sistema envia um reconhecimento caloroso dizendo que a equipe retorna por aqui assim que possível, então NÃO escreva você mesma esse reconhecimento nem repita o aviso.` +
    (reservationVerified
      ? `\n\nENTRADA E SAÍDA DO HÓSPEDE (registro no painel operacional)\n- Só chame register_guest_stay_event com CERTEZA ABSOLUTA de que o hóspede está DENTRO do imóvel (check-in) ou já SAIU dele (checkout, mesmo antes da data prevista).\n- Frases como "já chegamos", "estamos aqui", "chegamos no prédio" NÃO confirmam entrada: podem estar na portaria, na garagem ou em frente. Investigue com UMA pergunta natural e contextual, por exemplo: "Que bom! Vocês já conseguiram entrar no imóvel ou ainda estão do lado de fora?". Só registre quando ele afirmar que entrou/está dentro.\n- Planos ("vamos sair amanhã cedo", "que horas é o checkout?") NÃO são checkout. Na dúvida, pergunte se já deixaram o imóvel.\n- Se estiverem com dificuldade para entrar, oriente com as instruções de acesso nesta ordem de prioridade: 1) instruções do próprio anúncio (fonte airbnb_listing); 2) instruções do guia digital do imóvel. Não invente passos.\n- HORÁRIO PERMITIDO (check-in e check-out): o check-in só vale a partir do horário permitido do imóvel (ou do horário que a equipe definiu); o check-out tem horário limite. Se o hóspede disser que JÁ ENTROU antes do horário, ou pedir/mencionar sair DEPOIS do horário limite, chame search_stay_time_authorization e leia as mensagens da equipe e notas internas de TODOS os canais para entender se alguém da equipe autorizou a exceção (inclusive o horário definido pela equipe).\n- Achou autorização de entrada antecipada: registre o check-in citando o trecho literal em autorizacao_trecho. NÃO achou: NÃO registre; pergunte com gentileza se já está no imóvel e reforce o horário permitido de check-in.\n- Check-out acima do horário permitido: informe com gentileza que não é possível, salvo exceção autorizada pela equipe (se a busca encontrar essa autorização, siga o combinado). Nunca prometa exceção por conta própria.\n- PREVISÃO DE HORÁRIO: quando o hóspede disser a que horas vai CHEGAR ou SAIR (ex.: "chegamos às 15h", "saímos 10h30"), chame register_stay_time_forecast com evento checkin/checkout e confirme com carinho ("Anotado, te esperamos às 15h!"). Horário vago ("à tarde", "mais tarde", "às 3" sem manhã/tarde): NÃO registre e NÃO exija horário exato; peça uma ESTIMATIVA com base nas regras do anúncio (ex.: "o check-in é a partir das 15h; por volta de que horas vocês imaginam chegar?") e registre quando ele der uma estimativa clara. Você CONDUZ essa previsão (chegada e saída) e resolve sozinha: só registre o que estiver dentro do permitido em sistema ou alinhado com a equipe; se a ferramenta recusar por estar fora do permitido, explique o horário do anúncio e peça outra estimativa dentro dele, SEM acionar a equipe e sem prometer exceção: se a equipe quiser abrir uma exceção, ela mesma assume a conversa. Previsão não é entrada/saída: só register_guest_stay_event marca como realizado.\n- SAÍDA NO LIMITE: "saio nos últimos minutos", "no limite", "no horário máximo" = horário limite do anúncio; chame register_stay_time_forecast com horario='limite' no mesmo turno. Saída de madrugada (ex.: 2h30 da manhã): envie '02:30'.\n- SEM REDUNDÂNCIA: se a equipe acabou de informar o horário limite/regra na mensagem anterior, NÃO repita a regra como novidade; apenas confirme de forma breve o que o hóspede disse (ex.: "Anotado, Yasmin! Saída às 11h.") e acolha o contexto pessoal dele (voo, viagem) com naturalidade.\n- TOLERÂNCIA ZERO PÓS-CHECKOUT: NUNCA ofereça, sugira, prometa ou crie expectativa de checkout tardio, guardar malas no imóvel/portaria/condomínio, ou deixar carro na garagem após o horário limite. NADA disso é possível. A desocupação é total até o horário limite. Se o hóspede pedir ajuda com malas, indique apenas serviços EXTERNOS comerciais (guarda-volumes/lockers da cidade) via busca de lugares, deixando claro que são de terceiros.
- OBRIGATÓRIO E IMEDIATO: assim que o hóspede confirmar que está DENTRO do imóvel (ou concluiu a última etapa da entrada), chame register_guest_stay_event com checkin_completed NA MESMA resposta do encerramento de ENTRADA CONCLUÍDA. Assim que confirmar que SAIU ("já saímos", "deixei a chave no cofre", "fizemos o checkout"), chame com checkout_completed e agradeça a estadia. Nunca deixe essa baixa para a equipe.
- Depois de registrar, NÃO anuncie confirmação: é PROIBIDO escrever "sua saída está confirmada", "saída confirmada", "checkout confirmado", "confirmamos sua saída" ou "check-in confirmado". A primeira linha é só a saudação (se cabível) e um agradecimento simples pelo aviso (ex.: "Bom dia, Manoela! Obrigado por avisar."), seguindo direto para os demais assuntos. Nunca mencione sistema ou painel.`
      : "") +
    (channel === "airbnb"
      ? `\n\nCANAL AIRBNB — TEXTO PURO (prioridade sobre qualquer regra de formato acima)\n- O chat do Airbnb não renderiza formatação: PROIBIDO asteriscos, sublinhados, negrito, itálico, títulos com "#", imagens ou links.\n- ESTRUTURA LEVE (como no guia digital, só com quebras de linha): primeira frase responde direto; depois parágrafos curtos de 1-2 frases separados por linha em branco; 2+ opções, detalhes ou passos viram lista com "- " (ou "1. ", "2. " para sequência), cada item em uma linha; a pergunta/próximo passo final fica sozinha em sua própria linha. Nunca um bloco único e denso de texto. Resposta de uma frase só continua curta.\n- NUNCA envie URLs, links de mapa, sites, e-mails ou telefones: o Airbnb bloqueia a mensagem. Para localizar um lugar, diga o nome e o endereço/bairro para o hóspede buscar no Google Maps.`
      : "") +
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
  let toolsUsed: Array<{
    name: string;
    args?: unknown;
    durationMs?: number;
    parallelBatch?: number;
  }> = [];
  let errorMsg: string | null = null;

  const effort = reasoningFor(params.message, {
    highRisk: intent.urgency === "high" || plan.riskLevel === "high",
  });

  try {
    const run = await runAgent({
      task: "agent",
      instructions,
      input,
      tools,
      // Esforço e passos vêm da política única das duas IAs (ver
      // src/lib/ai/reasoning.ts). `agent.maxSteps` é o TETO do especialista; a
      // política diz quanto daquele teto a mensagem realmente merece.
      // 21/09/2026: aqui era `Math.max`, ou seja, toda mensagem — inclusive um
      // "oi" — nascia com a dúzia de passos liberada, e cada passo é uma
      // chamada paga. Uma pergunta difícil continua com o teto inteiro.
      maxSteps: Math.min(agent.maxSteps, maxStepsFor(effort)),
      reasoningEffort: effort,
      onTextDelta:
        params.onDraft && !credentialsLocked
          ? (() => {
              let step = -1;
              let acc = "";
              return (d: string, s: number) => {
                if (s !== step) {
                  step = s;
                  acc = "";
                }
                acc += d;
                params.onDraft?.(acc);
              };
            })()
          : undefined,
    });

    usage = mergeUsage(usage, run.usage);
    reply = run.text.trim();
    toolsUsed = run.toolCalls.map((c) => ({
      name: c.name,
      args: c.args,
      durationMs: c.durationMs,
      parallelBatch: c.parallelBatch,
    }));

    // O validador anti-alucinação só enxergava o TÍTULO da consulta de cada
    // ferramenta (via collectSource), nunca o resultado de fato — então não
    // tinha como confirmar se um lugar citado (nome, endereço, foto) veio
    // mesmo da ferramenta ou foi inventado pelo modelo na hora de redigir.
    // Agora o resultado real de cada chamada também vira evidência.
    for (const call of run.toolCalls) {
      if (call.result == null) continue;
      try {
        const serialized = JSON.stringify(call.result).slice(0, 2000);
        if (serialized && serialized !== "{}" && serialized !== "[]") {
          evidence.push(`[tool:${call.name}] ${serialized}`);
        }
      } catch {
        /* resultado não serializável — ignora, não é motivo pra falhar a resposta */
      }
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[agent] execução falhou", err);
    throw err;
  }

  // BAIXA AUTOMÁTICA DE CHECK-IN/CHECK-OUT: o hóspede confirmou a conclusão
  // e o modelo não registrou → o servidor registra pela própria ferramenta
  // (mantém as travas de horário/autorização e idempotência).
  if (reservationVerified && !toolsUsed.some((t) => t.name === "register_guest_stay_event")) {
    try {
      const { detectStayCompletion } = await import("./stay-completion-detect");
      const kind = detectStayCompletion(params.message, reply);
      const tool = kind ? buildGuestTools(toolCtx).find((t) => t.name === "register_guest_stay_event") : null;
      if (kind && tool) {
        const result = await tool.execute({
          evento: kind === "checkout" ? "checkout_completed" : "checkin_completed",
          evidencia: params.message.slice(0, 200),
          autorizacao_trecho: null,
        });
        toolsUsed.push({ name: "register_guest_stay_event", args: { kind, auto: true, result } });
      }
    } catch (e) {
      console.error("[agent] baixa automática de estadia falhou", e);
    }
  }

  rememberTools(
    params.conversationId,
    toolsUsed.map((t) => ({ name: t.name, args: t.args, ok: true, at: Date.now() })),
  );

  // Perguntou a um humano: responde com honestidade, nunca inventa.
  // A semente faz a frase variar entre uma ocorrência e a seguinte — duas
  // iguais em sequência denunciam o script (ver continuity.ts).
  const sementeFrase = params.history.length;
  if (escalationId && !reply) reply = pendingNotice(intent.language, sementeFrase);
  // Handoff NÃO é mais silencioso: a IA entrega a resposta parcial que
  // conseguiu montar e sinaliza a consulta interna. Só usamos o fallback
  // quando o modelo não produziu nada aproveitável.
  //
  // O texto fixo de antes ("...a equipe responsável seguirá com o atendimento
  // por aqui") anunciava transferência, contra a regra do produto e contra o
  // próprio prompt. Agora vem de continuity.ts, em primeira pessoa.
  // Sem texto: o bloco "depende de humano" mais abaixo decide saudação ou silêncio.
  void sementeFrase;

  // Decisões humanas já entregues ao hóspede não voltam ao contexto.
  if (humanAnswers.length && reply) {
    void markAnswersApplied({ supabase, ids: humanAnswers.map((a) => a.id) }).catch(
      () => undefined,
    );
  }

  stage("review", "Revisando os detalhes");
  // 6) Validação + 7) Reflection (puladas quando já escalamos para humano)
  const baseThresholds = thresholdsFor({
    explorationMode,
    category: intent.category,
    urgency: intent.urgency,
  });
  // O agente especialista pode exigir confiança maior que a categoria.
  const thresholds = explorationMode
    ? baseThresholds
    : {
        auto: Math.max(baseThresholds.auto, agent.thresholds.auto),
        hedged: Math.max(baseThresholds.hedged, agent.thresholds.hedged),
      };

  // Dados oficiais do hóspede desta conversa: sem eles o validador reprovava
  // saudações com o nome do hóspede como "alucinação" (caso Fabiane, 11/10/2026).
  const guestFacts = [
    params.guestName ? `Quem enviou a mensagem atual (chame por este primeiro nome): ${params.guestName}` : "",
    params.checkinDate ? `Check-in da reserva: ${params.checkinDate}` : "",
    params.checkoutDate ? `Check-out da reserva: ${params.checkoutDate}` : "",
    params.reservationDossier ? `RESERVA OFICIAL:\n${params.reservationDossier}` : "",
  ].filter(Boolean).join("\n");
  const evidenceText =
    [guestFacts ? `DADOS DO HÓSPEDE (fato oficial):\n${guestFacts}` : "", ...evidence.slice(0, 24)]
      .filter(Boolean)
      .join("\n\n") || "(nenhuma evidência recuperada)";
  /** O bloco de confiança já validou e já montou o texto final deste turno. */
  let jaValidado = false;
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

  // LATÊNCIA: a autoavaliação (e a revalidação do texto reescrito) só existe
  // para lapidar redação. Em turno de baixo risco — conversa da cidade,
  // recomendação, social, sem urgência — ela custava uma a duas idas extras ao
  // modelo antes do hóspede ver qualquer coisa. Nesses casos pulamos a
  // autoavaliação; a validação anti-alucinação continua rodando sempre.
  // 19/09/2026: a autoavaliação SAIU do caminho de resposta. Num modelo de
  // raciocínio ela só somava latência e chance de deturpar um texto que já
  // estava certo — o próprio modelo já revisa antes de escrever. A validação
  // anti-alucinação continua rodando em toda resposta.
  const skipReflection = true;

  /**
   * "Oi, tudo bem?" → "Olá! Tudo ótimo, como posso ajudar?" (21/09/2026)
   *
   * Uma resposta puramente social, sem ferramenta nenhuma chamada e sem um
   * único número, não afirma nada que possa ser conferido contra evidência —
   * e mesmo assim pagava uma checagem anti-invenção completa, em toda
   * saudação. Qualquer fato, código, horário, preço ou endereço tem dígito ou
   * veio de ferramenta: aí a checagem continua obrigatória.
   */
  const respostaSocialSimples =
    intent.category === "social" &&
    !highRiskContext &&
    toolsUsed.length === 0 &&
    reply.length <= 400 &&
    !/\d/.test(reply);

  if (reply && !handoffReason) {
    const [validated, reflected] = await Promise.all([
      validateAnswer({
        question: params.message,
        answer: reply,
        evidence: evidenceText,
        language: intent.language,
        policies: context.behavior || undefined,
        history: params.history,
        highRisk: highRiskContext,
        skip: respostaSocialSimples,
      }),
      reflectOnAnswer({
        question: params.message,
        answer: reply,
        evidence: evidenceText,
        language: intent.language,
        history: params.history,
        skip: skipReflection,
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
        history: params.history,
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

    // AUTONOMIA: o concierge só entrega a conversa a um humano quando o assunto
    // é realmente sensível (acesso, dinheiro, emergência, problema no imóvel) ou
    // quando o hóspede pede um humano de forma explícita. Dúvida comum com
    // confiança mediana NÃO vira handoff: sai com ressalva, como faria um
    // atendente experiente que responde e sugere confirmar.
    const explicitHuman = EXPLICIT_HUMAN_REQUEST.test(params.message);
    const sensitive = isSensitiveContext({
      category: intent.category,
      urgency: intent.urgency,
      riskLevel: plan.riskLevel,
    });
    const requestedHuman = finalValidation.needsHuman || reflection.needsHuman || plan.needsHuman;
    const forcedHuman = explicitHuman || (sensitive && requestedHuman);
    const forcedCause = explicitHuman
      ? "hóspede pediu atendimento humano"
      : forcedHuman
        ? finalValidation.needsHuman
          ? "validação anti-alucinação pediu humano em tema sensível"
          : reflection.needsHuman
            ? "autoavaliação pediu humano em tema sensível"
            : "planejador sinalizou necessidade de humano em tema sensível"
        : null;

    // Entrega da decisão da equipe: o humano acabou de responder — nunca reabre
    // outra pergunta sobre a mesma situação (o hóspede ficaria sem resposta).
    const deliveringHumanAnswer = (params as { proactiveTrigger?: string }).proactiveTrigger === "human_answer";
    if (!explorationMode && !deliveringHumanAnswer && (forcedHuman || (sensitive && tier === "handoff"))) {
      handoffReason =
        (forcedCause
          ? `${forcedCause} (confiança ${Math.round(confidence * 100)}%). `
          : `Confiança insuficiente em tema sensível (${Math.round(confidence * 100)}%). `) +
        `${finalValidation.reason || reflection.issues.join("; ") || "inconsistência"}. ` +
        `Pergunta: ${params.message.slice(0, 160)}`;
      handoffUrgency = intent.urgency === "high" ? "high" : "normal";

      /* A IA NÃO EMUDECE (correção de 11/09/2026).
       *
       * Aqui estava `reply = ""` — e esse vazio nunca era reposto, porque os
       * dois fallbacks lá em cima já tinham rodado e a trava de mais abaixo é
       * `if (reply && handoffReason)`, que não entra com string vazia. O efeito
       * medido: NENHUMA mensagem gravada na conversa, e o widget do hóspede
       * preenchendo o silêncio com "um atendente humano vai responder". Ou
       * seja, no momento mais delicado o sistema fazia exatamente as duas
       * coisas proibidas: sumia e anunciava transferência.
       *
       * Pior: jogava fora até texto APROVADO pelo validador, só porque o tema
       * era sensível. Escalar é sobre quem DECIDE, não sobre quem fala.
       *
       * Agora: se o texto passou na checagem, ele vai — acrescido da frase que
       * diz que a confirmação está em andamento. Se não passou (ou não havia
       * texto), sai só a frase, em primeira pessoa e variando a cada
       * ocorrência. Em nenhum caso o hóspede fica sem resposta. */
      // Sem promessa de retorno: texto aprovado vai sozinho; senão o bloco
      // "depende de humano" decide saudação (1ª fala) ou silêncio.
      const aprovado = finalValidation.approved && reply.trim().length > 0;
      reply = aprovado ? reply.trim() : "";
      tier = "handoff";
      jaValidado = true;
    } else if (tier !== "auto" && !explorationMode) {
      // Confiança mediana ou baixa fora de tema sensível: responde mesmo assim,
      // com a ressalva padrão — nunca deixa o hóspede sem resposta.
      reply = `${reply}${hedgeNotice(intent.language)}`;
      tier = "hedged";
    }
  } else if (handoffReason) {
    tier = "handoff";
    confidence = 1;
  }

  /**
   * A RESPOSTA PARCIAL DE UMA ESCALAÇÃO TAMBÉM PASSA PELO VALIDADOR.
   *
   * O bloco grande acima roda com `!handoffReason`: quando o modelo escala, a
   * checagem anti-alucinação e a autoavaliação eram puladas inteiras e a
   * confiança virava 1 por decreto. Só que o prompt MANDA responder
   * parcialmente antes de escalar — então justamente o texto entregue no
   * momento mais delicado era o único que ninguém revisava.
   *
   * Foi assim que saiu, para um hóspede que perguntou em que apartamento
   * estava, um "não consegui localizar sua reserva" que o contexto
   * desmentia (08/09/2026). A checagem é barata perto do estrago.
   *
   * Reprovado, o texto não é remendado: cai para uma frase curta e honesta.
   * Quem continua a conversa é a pessoa que recebeu a escalação.
   */
  // `jaValidado` evita revalidar o que o bloco de confiança acabou de validar:
  // aquele caminho já passou pelo validador e já montou o texto final. Sem esta
  // trava, gastaríamos uma chamada extra para reprovar a nossa própria frase de
  // continuidade — e o `handoffFallback` abaixo jogaria fora o texto aprovado.
  if (reply && handoffReason && !jaValidado) {
    const guard = await validateAnswer({
      question: params.message,
      answer: reply,
      evidence: evidenceText,
      language: intent.language,
      policies: context.behavior || undefined,
      history: params.history,
      highRisk: highRiskContext,
    });
    usage = mergeUsage(usage, guard.usage);
    models.validation = guard.model;
    validationResult = guard.validation;
    if (!guard.validation.approved) {
      reply = humanSupportReply(fullHistory, params.guestName ?? null, intent.language);
    }
  }

  // Todo transbordo vira pergunta respondível no cartão "A IA está te
  // perguntando" — sem isso, request_human_handoff só deixava um motivo solto.
  if (handoffReason && !escalationId && params.conversationId) {
    // Ponto 1: a equipe recebe o caso mastigado (resumo + o que já foi feito + resposta sugerida).
    const { usage: draftUsage, ...draft } = await buildHandoffDraft({
      history: fullHistory,
      guestMessage: params.message,
      reason: handoffReason,
      language: intent.language,
    });
    usage = mergeUsage(usage, draftUsage);
    escalationId = await askHumanSupervisor({
      supabase,
      ownerId,
      propertyId,
      conversationId: params.conversationId,
      guestKey,
      guestName: params.guestName ?? null,
      agent: agent.key,
      trigger: "unknown_information",
      reason: handoffReason,
      question: formatDraftForTeam(handoffReason, draft),
      contextSnapshot: { draft },
      guestMessage: params.message,
    }).catch(() => null);
  }

  // DÚVIDA COM A EQUIPE = SILÊNCIO TOTAL (19/10/2026, regra do anfitrião).
  // Com pergunta aberta no painel, nada vai ao hóspede (nem "agradeço o aviso",
  // nem "passei para a equipe"). A resposta única sai quando a equipe decide
  // (`answerEscalation` → `speakWithAgent`), evitando excesso de mensagens.
  if (escalationId) {
    reply = SILENCE_TOKEN;
  } else if (handoffReason) {
    const limpo = stripPromiseSentences(reply ?? "");
    const soSaudacao = !limpo || isOnlyGreeting(limpo);
    reply = soSaudacao
      ? acknowledgementReply({
          history: fullHistory,
          guestName: params.guestName ?? null,
          // Airbnb traduz sozinho: a IA sempre escreve em português nesse canal.
          language: replyInGuestLanguage ? intent.language : "pt",
          ticketCreated: false,
          notifiable: !!ownerId,
          formal: guestVoice.formal,
        })
      : limpo;
  }

  // Incidente de acesso (modo conversacional): barra alegação de ação remota.
  if (conversationalIncident && reply && claimsRemoteAction(reply)) {
    reply = safety.reply;
  }

  // Saudação obrigatória: se a IA ainda não cumprimentou ninguém nesta
  // conversa, a resposta abre com um cumprimento (inclusive frases fixas).
  if (reply) reply = ensureGreeting(reply, fullHistory, params.guestName ?? null, intent.language);

  // Voz: emoji/risada só se o hóspede usa, sem repetir (ver voice.ts) e, se a
  // resposta repete abertura/fecho/trechos das últimas falas, UMA reescrita
  // curta com modelo rápido (nunca em incidente/urgência/handoff; descartada
  // se mexer em números, horários, links ou nomes).
  let toneRewritten = false;
  if (reply && reply !== SILENCE_TOKEN) {
    reply = applyVoiceRules({ reply, history: fullHistory, voice: guestVoice, negative: voiceNegative, problem: voiceNegative });
    const sensitiveTurn = conversationalIncident || intent.urgency === "high" || !!handoffReason || !!escalationId;
    const issues = sensitiveTurn ? [] : toneLint(reply, fullHistory);
    if (issues.length >= 1 && reply.length >= 40) {
      try {
        const rw = await chatText("intent", [
          {
            role: "system",
            content:
              "Reescreva a mensagem abaixo com outras palavras para não repetir as últimas falas do assistente. " +
              "Mantenha o MESMO conteúdo, o mesmo idioma e o mesmo registro. Preserve exatamente números, horários, links e nomes. " +
              "Sem gíria. Não adicione emoji, risada nem informação nova. Responda apenas com a mensagem reescrita.",
          },
          {
            role: "user",
            content:
              `Últimas falas do assistente:\n${fullHistory.filter((m) => m.role === "assistant").slice(-3).map((m) => `- ${m.content.slice(0, 300)}`).join("\n")}\n\nMensagem a reescrever:\n${reply}`,
          },
        ]);
        usage = mergeUsage(usage, rw.usage);
        const out = rw.text.trim();
        if (out && rewritePreserves(reply, out) && out.length <= reply.length * 1.4) {
          reply = out;
          toneRewritten = true;
        }
      } catch {
        /* mantém o original */
      }
    }
    // Canais com tradução automática: português simples e sem abreviações.
    if (!replyInGuestLanguage) reply = makeTranslatable(reply);
  }

  // Botões de resposta rápida — sempre que a IA termina fazendo uma pergunta
  // ao hóspede, ele deve poder responder num toque (e continuar livre para
  // digitar). Só chamamos o modelo quando existe pergunta no texto: antes esta
  // etapa rodava em TODA mensagem, somando uma ida ao modelo mesmo quando não
  // havia nada a oferecer.
  let quickReplies: string[] = [];
  if (reply && /\?/.test(reply)) {
    const qr = await suggestQuickReplies({
      answer: reply,
      language: intent.language,
      category: intent.category,
    });
    usage = mergeUsage(usage, qr.usage);
    if (qr.model) models.quickReplies = qr.model;
    quickReplies = qr.options;
  }


  // 9) Persistência de memória + observabilidade (não bloqueiam a resposta)
  rememberMessage(params.conversationId, "assistant", reply);
  if (intent.category !== "operacional" && intent.urgency !== "high") {
    // pergunta resolvida fora de contexto operacional encerra o assunto em aberto
    if (!handoffReason) clearOpenTopic(params.conversationId);
  }

  const transcript = [
    ...params.history,
    { role: "user", content: params.message },
    { role: "assistant", content: reply },
  ];

  /**
   * ANÁLISE PÓS-CONVERSA SÓ ONDE HÁ O QUE APRENDER (21/09/2026)
   *
   * As duas rotinas abaixo — retrato do hóspede e seleção do que vira memória
   * de longo prazo — rodavam depois de TODA mensagem, inclusive de um "oi" ou
   * de um "obrigado". Eram duas chamadas de modelo por turno para concluir,
   * previsivelmente, que não havia nada a guardar.
   *
   * Agora só rodam quando a mensagem tem substância. Escalonamento, urgência e
   * reclamação passam sempre, independente do tamanho: é exatamente ali que
   * lembrar do que aconteceu importa.
   */
  const conversaComSubstancia =
    intent.category !== "social" &&
    (params.message.trim().length >= 12 ||
      intent.urgency === "high" ||
      intent.sentiment === "negativo" ||
      Boolean(handoffReason));

  if (conversaComSubstancia) {
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
  }

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
      // Só os prompts que REALMENTE rodam nesta resposta (planner/supervisor são
      // stubs determinísticos e a reflexão está desligada): carimbar os que não
      // rodam fazia o otimizador de prompts atribuir resultado a texto inativo.
      ...stampVersions([
        "agent",
        ...(skipReflection ? [] : (["reflection"] as const)),
        "validation",
        ...(explorationMode ? (["exploration"] as const) : []),
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
    rootCause: {
      ...buildRootCause({
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
      // Métricas de humanidade desta resposta (ver voice.ts / humanity-report).
      playbooksUsed: learnedPlaybooks.map((p) => ({ id: p.id, topic: p.topic, v: p.version })),
      humanity: humanityMetrics({
        reply: reply ?? "",
        guestMessage: params.message,
        history: fullHistory,
        voice: guestVoice,
        negative: voiceNegative,
        rewritten: toneRewritten,
        acknowledged: /equipe/i.test(reply ?? "") && /por aqui|here|por aquí/i.test(reply ?? "") && !!escalationId,
      }),
    },
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
                memories: guestContext.memories.map((m) => ({
                  id: m.id,
                  tier: m.tier,
                  score: m.score,
                })),
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
              metadata: {
                sources: sources.map((s) => ({ source: s.source, confidence: s.confidence })),
              },
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
    reply: finalizeAgentReply(reply, channel),
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
    quickReplies,
  };
}
