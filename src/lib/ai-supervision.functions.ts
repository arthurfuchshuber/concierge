/**
 * Supervisão da IA (backend): fila de perguntas ao humano e aprovação de
 * conhecimento aprendido. Sem UI — apenas a camada de dados/RPC.
 *
 * STATUS (auditoria de continuidade — ver AUDITORIA_IA_CONCIERGE.md):
 * - `answerEscalation` está REDUNDANTE desde a correção em `handoff.functions.ts`
 *   (`sendHandoffMessage`), que já marca escalonamentos pendentes como respondidos
 *   automaticamente quando um humano responde pelo dock — sem precisar desta rota.
 * - `listLearningCandidates`/`reviewLearningCandidate` duplicam, sem nenhum
 *   consumidor de UI confirmado, a pipeline REAL de aprovação de conhecimento
 *   que já existe em `@/lib/ai-learning.functions.ts` (essa sim usada por
 *   `admin.ia.tsx`) — que por sua vez lê a mesma tabela `ai_learning_candidates`
 *   e já cobre corretamente as candidatas criadas por `queueLearningCandidate`
 *   (via fallback `row.extracted_information ?? row.proposed_memory`).
 * - Não removemos este arquivo agora por não ser possível confirmar com 100% de
 *   certeza que nenhum consumidor externo (app mobile, cron, integração) o chama
 *   diretamente pelo nome da server function. Antes de apagar de vez, confirme
 *   isso no seu ambiente e então remova este arquivo e as duas funções análogas
 *   em `human-loop/learning.server.ts` (`approveLearningCandidate`/`rejectLearningCandidate`).
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
    const { data: esc, error: readErr } = await context.supabase
      .from("ai_human_escalations")
      .select("id, conversation_id, question_to_human")
      .eq("id", data.escalationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

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

    /**
     * A RESPOSTA CHEGA AO HÓSPEDE NA HORA (pedido explícito, 11/09/2026).
     *
     * Antes, a resposta ficava guardada esperando o hóspede mandar OUTRA
     * mensagem para ser entregue — e quem não escrevia de novo simplesmente
     * nunca recebia (foi o que aconteceu com a hóspede do Studio 103 em
     * 08/09, que até hoje está sem resposta). Agora o atendente responde à IA
     * e ela fala com o hóspede imediatamente, no próprio tom.
     *
     * Falhar aqui não desfaz a resposta: ela fica gravada e o caminho antigo
     * (entregar na próxima mensagem do hóspede) continua valendo como rede.
     */
    const conversationId = (esc as { conversation_id?: string | null } | null)?.conversation_id;
    let entregue = false;
    if (conversationId) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { speakWithAgent } = await import("@/lib/ai/outbound/speak.server");
        const pergunta =
          (esc as { question_to_human?: string | null } | null)?.question_to_human ?? "";
        const r = await speakWithAgent({
          supabase: supabaseAdmin as never,
          conversationId,
          reason: "human_answer",
          pushTitle: "Resposta sobre o seu pedido",
          instruction:
            `A equipe respondeu internamente à sua pergunta "${pergunta}": "${data.answer}". ` +
            "Leve essa resposta ao hóspede agora, na sua própria voz, como continuidade natural da conversa. " +
            "Não diga que consultou ninguém, não mencione equipe nem transferência — do ponto de vista dele, " +
            "quem sempre esteve na conversa é você. Se a resposta abrir um próximo passo, ofereça-o.",
        });
        entregue = r.sent;
        if (entregue) {
          await context.supabase
            .from("ai_human_escalations")
            .update({ applied_to_guest: true })
            .eq("id", data.escalationId);
        }
      } catch (e) {
        console.error("[supervision] entrega imediata falhou", (e as Error)?.message);
      }
    }

    return { ok: true, entregue };
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
    const { approveLearningCandidate, rejectLearningCandidate } =
      await import("./ai/human-loop/learning.server");

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
