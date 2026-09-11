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

/**
 * As perguntas da IA DESTA conversa — pendentes e as já respondidas.
 *
 * É o que faltava para a regra "o humano é consultor interno da IA" existir na
 * tela: a fila estava no banco e não tinha por onde ser lida. As respondidas
 * voltam junto porque a decisão do produto (11/09) é mostrar a pergunta nos
 * dois lugares — cartão ativo acima do campo enquanto está pendente, e balão
 * discreto no histórico depois de respondida.
 */
export const listConversationEscalations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { conversationId: string }) => {
    if (!input?.conversationId) throw new Error("conversationId obrigatório");
    return { conversationId: input.conversationId };
  })
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("ai_human_escalations")
      .select(
        "id, conversation_id, agent_type, reason, trigger, question_to_human, human_response, status, applied_to_guest, created_at, resolved_at",
      )
      .eq("conversation_id", data.conversationId)
      .in("status", ["pending", "answered", "dismissed"])
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Resposta humana à dúvida da IA — vira verdade absoluta na conversa. */
export const answerEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { escalationId: string; answer: string; saveAsKnowledge?: boolean }) => {
    if (!input?.escalationId) throw new Error("escalationId obrigatório");
    const answer = String(input.answer ?? "").trim();
    if (!answer) throw new Error("Resposta obrigatória");
    return {
      escalationId: input.escalationId,
      answer: answer.slice(0, 2000),
      // Marcado por padrão (decisão de produto, 11/09): a IA aprende sozinha e
      // o atendente desmarca quando for caso isolado. Nada entra na memória
      // sem a aprovação na tela de conhecimento — isto só cria a candidata.
      saveAsKnowledge: input.saveAsKnowledge !== false,
    };
  })
  .handler(async ({ data, context }) => {
    const { data: esc, error: readErr } = await context.supabase
      .from("ai_human_escalations")
      .select("id, conversation_id, question_to_human, owner_id, property_id, agent_type")
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

    /**
     * A RESPOSTA VIRA CANDIDATA A CONHECIMENTO (11/09/2026).
     *
     * Antes, o único caminho de captura era `sendHandoffMessage` — ou seja, só
     * aprendia quando o atendente falava DIRETO com o hóspede, e com um filtro
     * anti-lixo que era só comprimento (≥15 caracteres), então "Olá, Luiz,
     * tudo bem?" entrava na fila de revisão. Aqui a captura nasce do lugar
     * certo: uma pergunta objetiva da IA e a decisão que a responde. É o par
     * pergunta/resposta mais limpo que o sistema produz.
     *
     * Continua sem escrever em memória: `learnFromHumanAnswer` só cria a
     * candidata, e nada vale antes da sua aprovação.
     */
    let aprendizado: string | null = null;
    const e = esc as {
      owner_id?: string | null;
      property_id?: string | null;
      agent_type?: string | null;
      question_to_human?: string | null;
    } | null;
    if (data.saveAsKnowledge && e?.owner_id) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { learnFromHumanAnswer } = await import("./ai/human-loop/learning.server");
        const r = await learnFromHumanAnswer({
          supabase: supabaseAdmin,
          ownerId: String(e.owner_id),
          propertyId: e.property_id ?? null,
          escalationId: data.escalationId,
          conversationId: conversationId ?? null,
          agent: e.agent_type ?? undefined,
          question: e.question_to_human ?? "",
          humanAnswer: data.answer,
        });
        aprendizado = r.candidateId;
      } catch (err) {
        // Aprender é enriquecimento: falhar aqui não desfaz a resposta ao
        // hóspede, que é o que importa neste momento.
        console.error("[supervision] captura de conhecimento falhou", (err as Error)?.message);
      }
    }

    return { ok: true, entregue, aprendizado };
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
