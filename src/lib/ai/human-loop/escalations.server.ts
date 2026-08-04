/**
 * Human-in-the-Loop — a IA pergunta ao supervisor humano quando não sabe.
 *
 * Fluxo: a IA registra a dúvida (`ai_human_escalations`), avisa o hóspede que
 * está confirmando com a equipe e NUNCA inventa a resposta. Quando um humano
 * responde, a decisão volta para a conversa e vira candidata a conhecimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentKey } from "../agents/types";

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
};

/** Cria a pergunta ao supervisor humano. Retorna o id do escalonamento. */
export async function askHumanSupervisor(input: EscalationInput): Promise<string | null> {
  try {
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
        context_snapshot: (input.contextSnapshot ?? {}) as never,
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

/** Aviso honesto ao hóspede enquanto a equipe não responde. */
export function pendingNotice(language: string): string {
  if (language?.startsWith("en")) return "I'm confirming this with the host's team so I can give you the right answer — I'll get back to you shortly.";
  if (language?.startsWith("es")) return "Estoy confirmando esto con el equipo del anfitrión para darte la respuesta correcta — te aviso enseguida.";
  return "Estou confirmando isso com a equipe do anfitrião para te passar a informação certa — já te retorno.";
}
