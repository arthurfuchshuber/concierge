import { buildDecisionSpec } from "./decision-options";
/**
 * Human-in-the-Loop — a IA pergunta ao supervisor humano quando não sabe.
 *
 * Fluxo: a IA registra a dúvida (`ai_human_escalations`) e aguarda a decisão
 * da equipe em silêncio, sem inventar a resposta. Quando um humano
 * responde, a decisão volta para a conversa e vira candidata a conhecimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentKey } from "../agents/types";
import { continuityLine } from "../continuity";

type Admin = SupabaseClient;

export type EscalationTrigger =
  | "unknown_information"
  | "low_confidence"
  | "policy_exception"
  | "financial_decision"
  | "safety_risk"
  | "guest_request";

export type EscalationInput = {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  conversationId: string | null;
  guestKey?: string | null;
  guestName?: string | null;
  agent: AgentKey;
  trigger: EscalationTrigger;
  reason: string;
  question: string;
  confidence?: number | null;
  contextSnapshot?: Record<string, unknown>;
  /** Fala do hóspede que originou a dúvida — gera os botões de resposta. */
  guestMessage?: string | null;
  decisionKind?: "operational" | "fact";
};

/** Cria a pergunta ao supervisor humano. Retorna o id do escalonamento. */
export async function askHumanSupervisor(input: EscalationInput): Promise<string | null> {
  try {
    const snapshot = withDecision(input);
    // Deduplicação conservadora de repetição/retry, não de conversa inteira.
    // Cartões antigos, proativos ou de aprendizado não absorvem dúvidas novas.
    const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const escalationKey = JSON.stringify([
      input.propertyId, input.agent, input.trigger, normalize(input.question.slice(0, 1200)),
      normalize((input.guestMessage ?? input.question).slice(0, 1200)),
      input.decisionKind ?? null, !!snapshot.proactive, !!snapshot.host_learning,
    ]);
    const guestNorm = input.guestMessage ? normalize(input.guestMessage.slice(0, 1200)) : "";
    if (input.conversationId) {
      const { data: pend } = await input.supabase
        .from("ai_human_escalations")
        .select("id")
        .eq("owner_id", input.ownerId)
        .eq("conversation_id", input.conversationId)
        .eq("status", "pending")
        .eq("context_snapshot->>escalation_key", escalationKey)
        .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .limit(1);
      const existing = (pend as Array<{ id: string }> | null)?.[0]?.id;
      if (existing) return String(existing);
      // Mesma mensagem do hóspede, pergunta reescrita pela IA: continua sendo
      // UMA dúvida — nunca um segundo cartão no chat nem um segundo push.
      if (guestNorm && !snapshot.proactive && !snapshot.host_learning) {
        const { data: same } = await input.supabase
          .from("ai_human_escalations")
          .select("id")
          .eq("owner_id", input.ownerId)
          .eq("conversation_id", input.conversationId)
          .eq("property_id", input.propertyId)
          .eq("status", "pending")
          .eq("context_snapshot->>guest_message_norm", guestNorm)
          .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
          .limit(1);
        const twin = (same as Array<{ id: string }> | null)?.[0]?.id;
        if (twin) return String(twin);
      }
    }
    const { data, error } = await input.supabase
      .from("ai_human_escalations")
      .insert({
        owner_id: input.ownerId,
        tenant_id: input.ownerId,
        property_id: input.propertyId,
        conversation_id: input.conversationId,
        guest_key: input.guestKey ?? null,
        guest_name: input.guestName ?? null,
        agent_type: input.agent,
        trigger: input.trigger,
        reason: input.reason.slice(0, 800),
        question_to_human: input.question.slice(0, 1200),
        confidence_score: input.confidence ?? null,
        context_snapshot: { ...snapshot, escalation_key: escalationKey, ...(guestNorm && !snapshot.proactive && !snapshot.host_learning ? { guest_message_norm: guestNorm } : {}) } as never,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) throw error;
    return data?.id ? String(data.id) : null;
  } catch (err) {
    console.error("[human-loop] falha ao registrar escalonamento", err);
    return null;
  }
}

export type AnsweredEscalation = {
  id: string;
  question: string;
  answer: string;
  agent: string;
  createdAt: string;
};

/**
 * Respostas humanas já dadas nesta conversa e ainda não entregues ao hóspede.
 * Elas entram no contexto do agente como VERDADE ABSOLUTA.
 */
export async function pendingHumanAnswers(params: {
  supabase: Admin;
  conversationId: string | null;
}): Promise<AnsweredEscalation[]> {
  if (!params.conversationId) return [];
  try {
    const { data } = await params.supabase
      .from("ai_human_escalations")
      .select("id, question_to_human, human_response, agent_type, created_at")
      .eq("conversation_id", params.conversationId)
      .eq("status", "answered")
      .eq("applied_to_guest", false)
      .order("created_at", { ascending: true })
      .limit(5);

    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((r) => !!r.human_response)
      .map((r) => ({
        id: String(r.id),
        question: String(r.question_to_human ?? ""),
        answer: String(r.human_response ?? ""),
        agent: String(r.agent_type ?? "generalist"),
        createdAt: String(r.created_at ?? ""),
      }));
  } catch (err) {
    console.error("[human-loop] falha ao ler respostas humanas", err);
    return [];
  }
}

/** Marca as respostas humanas como já entregues ao hóspede. */
export async function markAnswersApplied(params: {
  supabase: Admin;
  ids: string[];
}): Promise<void> {
  if (!params.ids.length) return;
  try {
    await params.supabase
      .from("ai_human_escalations")
      .update({ applied_to_guest: true })
      .in("id", params.ids);
  } catch (err) {
    console.error("[human-loop] falha ao marcar respostas aplicadas", err);
  }
}

/** Bloco de contexto com as decisões humanas — prioridade máxima no prompt. */
export function renderHumanAnswers(answers: AnsweredEscalation[]): string {
  if (!answers.length) return "";
  return (
    "\n\nDECISÕES JÁ TOMADAS POR UM HUMANO DA EQUIPE (verdade absoluta — use exatamente isto, " +
    "sem reinterpretar e sem contradizer)\n" +
    answers.map((a) => `- Pergunta: ${a.question}\n  Decisão humana: ${a.answer}`).join("\n")
  );
}

/**
 * Aviso honesto ao hóspede enquanto a consulta interna não volta.
 *
 * ANTES dizia "com a equipe do anfitrião" — nomeava um terceiro e, para quem
 * lê, isso É a transferência que a regra do produto proíbe. O texto agora vem
 * de `continuity.ts`, em primeira pessoa e com variação. Ver o cabeçalho de lá.
 */
export function pendingNotice(language: string, seed = 0): string {
  return continuityLine("pending", language, seed);
}

function withDecision(input: EscalationInput): Record<string, unknown> {
  const snap = { ...(input.contextSnapshot ?? {}) };
  if (!snap.decision) {
    snap.decision = buildDecisionSpec(input.guestMessage ?? input.question, input.decisionKind);
  }
  return snap;
}
