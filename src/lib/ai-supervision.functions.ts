/**
 * Supervisão da IA (backend): fila de perguntas ao humano e aprovação de
 * conhecimento aprendido. Sem UI — apenas a camada de dados/RPC.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Perguntas pendentes que a IA fez à equipe. */
export const listPendingEscalations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_human_escalations")
      .select(
        "id, property_id, conversation_id, agent_type, guest_name, reason, trigger, question_to_human, confidence_score, status, human_response, created_at",
      )
      .in("status", ["pending", "answered"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Resposta humana à dúvida da IA — vira verdade absoluta na conversa. */
export const answerEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { escalationId: string; answer: string }) => {
    if (!input?.escalationId) throw new Error("escalationId obrigatório");
    const answer = String(input.answer ?? "").trim();
    if (!answer) throw new Error("Resposta obrigatória");
    return { escalationId: input.escalationId, answer: answer.slice(0, 2000) };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("ai_human_escalations")
      .update({
        human_response: data.answer,
        human_user_id: context.userId,
        status: "answered",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", data.escalationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Conhecimento destilado aguardando aprovação humana. */
export const listLearningCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("ai_learning_candidates")
      .select(
        "id, property_id, agent_type, title, proposed_memory, category, memory_kind, recommended_scope, confidence, ttl_days, rationale, approval_status, created_at",
      )
      .eq("approval_status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Aprovação explícita: só aqui o conhecimento entra na memória de longo prazo. */
export const reviewLearningCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      candidateId: string;
      decision: "approve" | "reject";
      approvedScope?: "property" | "owner_portfolio" | "company_global" | "temporary_exception";
      editedMemory?: string | null;
    }) => {
      if (!input?.candidateId) throw new Error("candidateId obrigatório");
      if (input.decision !== "approve" && input.decision !== "reject") {
        throw new Error("decision inválida");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    // Confirma que o revisor enxerga a candidata (RLS decide o acesso).
    const { data: row, error } = await context.supabase
      .from("ai_learning_candidates")
      .select("id")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Candidata não encontrada");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { approveLearningCandidate, rejectLearningCandidate } = await import(
      "./ai/human-loop/learning.server"
    );

    if (data.decision === "reject") {
      await rejectLearningCandidate({
        supabase: supabaseAdmin,
        candidateId: data.candidateId,
        reviewerId: context.userId,
      });
      return { ok: true, approved: false };
    }

    const result = await approveLearningCandidate({
      supabase: supabaseAdmin,
      candidateId: data.candidateId,
      reviewerId: context.userId,
      approvedScope: data.approvedScope,
      editedMemory: data.editedMemory ?? null,
    });
    if (!result.ok) throw new Error(result.error ?? "Falha ao aprovar");
    return { ok: true, approved: true };
  });
