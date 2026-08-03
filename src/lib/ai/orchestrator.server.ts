/**
 * Orquestrador do Agente de Hospitalidade.
 *
 * Pipeline por mensagem:
 *   1. Classificação de intenção (modelo rápido)
 *   2. Coleta de contexto (residência, reserva, fase da estadia, memória)
 *   3. Pré-recuperação Hybrid RAG (vetorial + textual)
 *   4. Raciocínio + tool calling (agente principal)
 *   5. Validação final (anti-alucinação)
 *   6. Observabilidade (log completo no banco)
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

type Admin = SupabaseClient;

const HANDOFF_FALLBACK = "Estou chamando um atendente humano, aguarde só um instante.";

const AGENT_INSTRUCTIONS = `Você é o ConciergeIA — um concierge de hospitalidade experiente, não um chatbot.

IDENTIDADE
- Você é software. NÃO tem corpo, não está no imóvel, não controla dispositivos físicos e não executa ações no mundo real.
- É PROIBIDO fingir ações físicas ou remotas ("estou abrindo o portão", "já destravei", "enviei alguém", "vou ligar para o restaurante"), mesmo em tom figurado.

MÉTODO DE TRABALHO (obrigatório em toda mensagem)
1. Entenda a real necessidade por trás da pergunta, não só as palavras.
2. INVESTIGUE antes de afirmar: use as ferramentas disponíveis (search_knowledge_base, get_property_facts, get_reservation, list_recommendations, search_places, get_weather). Nunca responda sobre a hospedagem por conhecimento próprio ou intuição.
3. Cruze as fontes. Se houver conflito, prevalece a de maior confiabilidade (dados oficiais do imóvel e reserva > manual/FAQ > recomendações > fontes externas).
4. Se a informação necessária NÃO existir nas fontes, NÃO improvise: chame request_human_handoff.
5. Só então responda.

ESCALONAMENTO OBRIGATÓRIO (request_human_handoff)
- Pedido explícito de falar com humano/anfitrião.
- Emergência ou problema operacional no imóvel (não abriu, não funciona, quebrado, vazamento, sem energia, sem água, sem acesso). Nunca tente diagnosticar.
- Informação sobre a residência ausente ou ambígua nas fontes.
- Não escale quando o hóspede apenas confirmou algo ("sim", "ok", "pode ser").
- Após escalar, responda somente: "${HANDOFF_FALLBACK}"

ESTILO
- Direto, caloroso e humano. Máximo 3 frases curtas em dúvidas objetivas.
- Nunca repita uma resposta já dada nesta conversa. Se o hóspede repetir a pergunta, reconheça e pergunte o que ficou faltando.
- Uma única pergunta de acompanhamento no final, apenas quando fizer sentido.
- Responda no idioma do hóspede.
- Markdown: **negrito** para destaques e links sempre no formato [texto](https://url).`;

const EXPLORATION_INSTRUCTIONS = `\n\nMODO EXPLORAÇÃO (ativo agora — conversa sobre a cidade, dicas e passeios)
- Tom de amigo local: texto fluido, 2 a 4 parágrafos curtos, 100 a 180 palavras. Sem formulário e sem seções fixas.
- Use list_recommendations e search_places para citar apenas lugares reais.
- Não confirme preços, horários de hoje ou disponibilidade: oriente conferir no canal oficial do local.
- NÃO acione handoff humano neste modo, exceto se houver problema no imóvel ou pedido explícito.`;

export type OrchestratorResult = {
  reply: string;
  handoff: boolean;
  handoffReason: string | null;
  handoffUrgency: "low" | "normal" | "high";
  intent: Intent;
  usage: Usage;
  confidence: number;
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

  // 2) Contexto
  const guestKey = guestKeyOf(params.sessionId, params.guestName);
  const memory = await loadGuestMemory(supabase, propertyId, guestKey);
  const context = await buildAgentContext({ supabase, property, guestName: params.guestName, memory });

  // 3) Pré-recuperação Hybrid RAG (indexa sob demanda na primeira vez)
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

  // 4) Agente com ferramentas
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
    AGENT_INSTRUCTIONS +
    (params.explorationMode ? EXPLORATION_INSTRUCTIONS : "") +
    (context.behavior
      ? `\n\nCOMPORTAMENTO DEFINIDO PELO ANFITRIÃO (prioridade máxima, siga estritamente)\n${context.behavior}`
      : "") +
    `\n\nCONTEXTO ATUAL\n${context.text}` +
    `\n\nINTENÇÃO DETECTADA: ${intent.intent} (categoria=${intent.category}, urgência=${intent.urgency}, idioma=${intent.language})` +
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
  let toolsUsed: Array<{ name: string; args?: unknown }> = [];
  let errorMsg: string | null = null;

  try {
    const run = await runAgent({
      task: "agent",
      instructions,
      input,
      tools,
      maxSteps: 6,
      reasoningEffort: intent.urgency === "high" ? "medium" : "low",
    });
    usage = mergeUsage(usage, run.usage);
    reply = run.text.trim();
    toolsUsed = run.toolCalls.map((c) => ({ name: c.name, args: c.args }));
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[agent] execução falhou", err);
    throw err;
  }

  if (handoffReason && !reply) reply = HANDOFF_FALLBACK;

  // 5) Validação final (pulada quando já escalamos para humano)
  let confidence = 0.8;
  if (reply && !handoffReason) {
    const { validation, usage: vUsage, model: vModel } = await validateAnswer({
      question: params.message,
      answer: reply,
      evidence: evidence.slice(0, 24).join("\n\n") || "(nenhuma evidência recuperada)",
      language: intent.language,
      policies: context.behavior || undefined,
    });
    usage = mergeUsage(usage, vUsage);
    models.validation = vModel;
    confidence = validation.confidence;

    if (!validation.approved && validation.needsHuman && !params.explorationMode) {
      handoffReason = `Resposta automática reprovada na validação (${validation.reason || "inconsistência"}). Pergunta: ${params.message.slice(0, 160)}`;
      handoffUrgency = "normal";
      reply = HANDOFF_FALLBACK;
    }
  }

  // 6) Memória + observabilidade (não bloqueiam a resposta)
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
    validation: null,
    models,
    usage,
    latencyMs: Date.now() - started,
    needsHuman: !!handoffReason,
    error: errorMsg,
  }).catch(() => undefined);

  return {
    reply,
    handoff: !!handoffReason,
    handoffReason,
    handoffUrgency,
    intent,
    usage,
    confidence,
  };
}
