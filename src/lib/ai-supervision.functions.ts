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
        "id, conversation_id, agent_type, reason, trigger, question_to_human, human_response, status, applied_to_guest, created_at, resolved_at, context_snapshot",
      )
      .eq("conversation_id", data.conversationId)
      .in("status", ["pending", "answered", "dismissed"])
      .order("created_at", { ascending: true })
      .limit(20);
    if (error) throw new Error(error.message);
    const list = rows ?? [];
    if (list.some((r) => r.status === "pending")) return list;

    // Auto-recuperação: conversa em transbordo sem pergunta registrada vira
    // pergunta respondível no cartão. RLS da leitura confirma o acesso.
    const { data: conv } = await context.supabase
      .from("property_chat_conversations")
      .select("id, property_id, status, handoff_reason, handoff_at, guest_name")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conv || conv.status !== "needs_human" || !conv.handoff_reason) return list;
    const handoffAt = conv.handoff_at ? new Date(conv.handoff_at).getTime() : 0;
    const coveredByResolved = list.some(
      (r) => new Date((r as { resolved_at?: string | null }).resolved_at ?? r.created_at).getTime() >= handoffAt,
    );
    if (coveredByResolved) return list;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("owner_id")
      .eq("id", conv.property_id)
      .maybeSingle();
    if (!prop?.owner_id) return list;
    const reason = String(conv.handoff_reason).slice(0, 800);
    const { data: created, error: insErr } = await supabaseAdmin
      .from("ai_human_escalations")
      .insert({
        owner_id: prop.owner_id,
        property_id: conv.property_id,
        conversation_id: conv.id,
        guest_name: conv.guest_name,
        agent_type: "concierge",
        trigger: "unknown_information",
        reason,
        question_to_human: reason.replace(/^\[[^\]]+\]\s*/, ""),
        status: "pending",
      } as never)
      .select(
        "id, conversation_id, agent_type, reason, trigger, question_to_human, human_response, status, applied_to_guest, created_at, resolved_at, context_snapshot",
      )
      .maybeSingle();
    if (insErr || !created) {
      console.error("[escalations] auto-recuperação falhou", insErr?.message);
      return list;
    }
    return [...list, created];
  });

/** Resposta humana à dúvida da IA — vira verdade absoluta na conversa. */
export const answerEscalation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { escalationId: string; answer: string; saveAsKnowledge?: boolean; knowledgeScope?: "property" | "global" }) => {
    if (!input?.escalationId) throw new Error("escalationId obrigatório");
    const answer = String(input.answer ?? "").trim();
    if (!answer) throw new Error("Resposta obrigatória");
    return {
      escalationId: input.escalationId,
      answer: answer.slice(0, 2000),
      // Escolha EXPLÍCITA da equipe (18/10/2026): nada pré-marcado.
      saveAsKnowledge: input.saveAsKnowledge === true,
      knowledgeScope: (input.knowledgeScope === "global" ? "global" : "property") as "property" | "global",
    };
  })
  .handler(async ({ data, context }) => {
    const { data: esc, error: readErr } = await context.supabase
      .from("ai_human_escalations")
      .select("id, conversation_id, question_to_human, owner_id, property_id, agent_type, context_snapshot")
      .eq("id", data.escalationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    const { readDecisionSpec, canBecomeKnowledge, actionFor, learningScopeOf, isTakeoverOption } = await import("./ai/human-loop/decision-options");
    const spec = readDecisionSpec((esc as { context_snapshot?: unknown } | null)?.context_snapshot);
    // Decisão operacional (ex.: liberar check-in antecipado) nunca vira conhecimento.
    if (spec && !canBecomeKnowledge(spec.kind)) data.saveAsKnowledge = false;
    // "Eu assumo a conversa": a equipe responde direto — nada vai ao hóspede pela IA.
    const takeover = !!spec && isTakeoverOption(data.answer);
    if (takeover) data.saveAsKnowledge = false;

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
    // Cada pergunta é independente: a resposta vale SÓ para esta escalação.
    // Outras perguntas abertas da mesma conversa seguem pendentes, separadas.
    // Ação vinculada à opção (copiloto proativo): executa agora, com desfazer na tela.
    const action = actionFor(spec, data.answer);
    let executed: { action: string; reservationId: string; previouslyDone: boolean } | null = null;
    if (action !== "none" && conversationId) {
      executed = await runDecisionAction(context.supabase, conversationId, action);
    }
    // Decisões operacionais com ação, ou "Aguardar o horário oficial": nada a dizer ao hóspede.
    // Cartões proativos são internos (ação ou "virar conhecimento?") — nunca falam com o hóspede.
    const proactive = !!(esc as { context_snapshot?: { proactive?: boolean } } | null)?.context_snapshot?.proactive;
    // Cartão de aprendizado da resposta dada direto no Airbnb: o hóspede já recebeu.
    const hostLearning = !!(esc as { context_snapshot?: { host_learning?: boolean } } | null)?.context_snapshot?.host_learning;
    // Regra (19/10/2026): a IA responde a tudo. Toda decisão sobre o pedido do
    // hóspede vira UMA resposta na hora. Silêncio só em: "Eu assumo", cartão de
    // conhecimento (fact proativo), ação técnica executada no sistema ou "Aguardar".
    // Antecipação liberada pela equipe (limpeza pronta): o horário de agora vira
    // fato da reserva, então a IA nunca volta ao horário padrão depois.
    const earlyRelease = !!(esc as { context_snapshot?: { early_release?: unknown } } | null)?.context_snapshot?.early_release;
    const { earlyReleaseApproved, earlyReleaseSilent } = await import("./ai/human-loop/decision-options");
    if (earlyRelease && conversationId && earlyReleaseApproved(data.answer)) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { registerAgreedStayTime } = await import("./ai/stay-intent-resolver.server");
        const nowHm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
        const propertyId = (esc as { property_id?: string | null } | null)?.property_id;
        if (propertyId) await registerAgreedStayTime(supabaseAdmin as never, { propertyId, conversationId, kind: "checkin", time: nowHm });
      } catch (e) {
        console.error("[supervision] registrar liberação antecipada falhou", (e as Error)?.message);
      }
    }
    const silentDecision =
      takeover ||
      hostLearning ||
      (proactive && spec?.kind === "fact") ||
      action !== "none" ||
      earlyReleaseSilent(data.answer);
    if (takeover && conversationId) {
      const { error: claimErr } = await context.supabase
        .from("property_chat_conversations")
        .update({ status: "assigned", assigned_to: context.userId, claim_requested_by: null, claim_requested_at: null })
        .eq("id", conversationId);
      if (claimErr) console.error("[supervision] assumir conversa falhou", claimErr.message);
    }
    if (conversationId && !silentDecision) {
      // A decisão da equipe vira a resposta única: cancela resposta automática
      // agendada em segundo plano para a mesma pergunta (evita resposta dupla).
      await context.supabase
        .from("property_chat_conversations")
        .update({ ai_reply_due_at: null } as never)
        .eq("id", conversationId)
        .then(() => undefined, () => undefined);
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
            "Trate essa escolha como FATO verdadeiro, não como o texto a enviar. Responda como concierge de alto padrão: " +
            "releia a conversa inteira e a pergunta real do hóspede, combine a decisão com os dados reais do imóvel e da reserva " +
            "(busque nas fontes quando necessário — localização do item, instruções, horários) e conduza a conversa: " +
            "se houver próximo passo natural, ofereça-o; se a decisão liberar algo, entregue o necessário para ele agir. " +
            "Seja conciso e elegante: sem repetir o que já foi dito, sem excesso, sem inventar nada fora das fontes. " +
            "Não diga que consultou ninguém, não mencione equipe nem transferência — do ponto de vista dele, quem sempre esteve na conversa é você.",
        });
        entregue = r.sent;
        if (entregue) {
          const snap = ((esc as { context_snapshot?: Record<string, unknown> | null } | null)?.context_snapshot ?? {}) as Record<string, unknown>;
          await context.supabase
            .from("ai_human_escalations")
            .update({ applied_to_guest: true, context_snapshot: { ...snap, delivered_message_id: r.messageId ?? null } } as never)
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
          forcedScope: learningScopeOf(data.knowledgeScope),
        });
        aprendizado = r.candidateId;
      } catch (err) {
        // Aprender é enriquecimento: falhar aqui não desfaz a resposta ao
        // hóspede, que é o que importa neste momento.
        console.error("[supervision] captura de conhecimento falhou", (err as Error)?.message);
      }
    }

    return { ok: true, entregue, aprendizado, executed, silent: silentDecision };
  });

type Sb = import("@supabase/supabase-js").SupabaseClient;

/** Executa a ação escolhida no cartão (check-in/check-out), pela mesma rotina do painel. */
async function runDecisionAction(
  sb: Sb,
  conversationId: string,
  action: "checkin_done" | "checkout_done",
): Promise<{ action: string; reservationId: string; previouslyDone: boolean } | null> {
  const { data: conv } = await sb
    .from("property_chat_conversations")
    .select("property_id, reservation_id")
    .eq("id", conversationId)
    .maybeSingle();
  const c = conv as { property_id: string | null; reservation_id: string | null } | null;
  if (!c?.property_id || !c.reservation_id) throw new Error("Esta conversa ainda não está ligada a uma reserva.");
  const kind = action === "checkin_done" ? "checkin" : "checkout";
  const { data: rows } = await sb.from("guest_arrival_status").select("kind, status, done_at").eq("reservation_id", c.reservation_id);
  const list = (rows ?? []) as Array<{ kind: string; status: string; done_at: string | null }>;
  const previouslyDone = list.some((r) => r.kind === kind && (r.status === "done" || !!r.done_at));
  const { findStayForEvent, applyStayEvent } = await import("./ai/stay-events.server");
  const stay = await findStayForEvent(sb, { propertyId: c.property_id, checkinDate: null, checkoutDate: null, conversationId });
  if (!stay) throw new Error("Não encontrei a estadia desta conversa.");
  const r = await applyStayEvent(sb, stay, kind);
  if (!r.ok) throw new Error(r.motivo === "checkin_futuro" ? "O check-in desta reserva ainda é em data futura." : "Não foi possível registrar no painel.");
  return { action, reservationId: stay.reservationId, previouslyDone };
}

/**
 * DESFAZER / REFAZER DECISÃO (19/10/2026).
 * Reabre a pergunta da IA para a equipe escolher de novo e, se a decisão tinha
 * executado uma ação (check-in/check-out), volta o card do painel um passo.
 */
export const reopenEscalationDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { escalationId: string; revert?: { action: string; reservationId: string; previouslyDone: boolean } | null }) => {
    if (!input?.escalationId) throw new Error("escalationId obrigatório");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: esc, error } = await context.supabase
      .from("ai_human_escalations")
      .select("id, conversation_id, human_response, context_snapshot")
      .eq("id", data.escalationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!esc) throw new Error("Pergunta não encontrada.");

    // Ação a reverter: a informada pela tela (desfazer de 5s) ou a deduzida da resposta gravada.
    let revert = data.revert ?? null;
    if (!revert) {
      const { readDecisionSpec, actionFor } = await import("./ai/human-loop/decision-options");
      const e = esc as { conversation_id: string | null; human_response: string | null; context_snapshot: unknown };
      const action = actionFor(readDecisionSpec(e.context_snapshot), e.human_response ?? "");
      if (action !== "none" && e.conversation_id) {
        const { data: conv } = await context.supabase
          .from("property_chat_conversations")
          .select("reservation_id")
          .eq("id", e.conversation_id)
          .maybeSingle();
        const rid = (conv as { reservation_id?: string | null } | null)?.reservation_id;
        if (rid) revert = { action, reservationId: rid, previouslyDone: false };
      }
    }
    if (revert && !revert.previouslyDone) {
      const kind = revert.action === "checkout_done" ? "checkout" : revert.action === "checkin_done" ? "checkin" : null;
      if (kind) {
        const { error: uErr } = await context.supabase
          .from("guest_arrival_status")
          .update({ status: "pending", done_at: null, concluded_at: null } as never)
          .eq("reservation_id", revert.reservationId)
          .eq("kind", kind);
        if (uErr) throw new Error(uErr.message);
      }
    }

    /* REFAZER APAGA A RESPOSTA JÁ ENVIADA (pedido explícito, 19/10/2026).
     * Guia/painel: a mensagem some da conversa. Airbnb não permite apagar
     * mensagens entregues pela API: removemos do histórico e enviamos uma
     * retificação curta para o hóspede desconsiderar a anterior. */
    const snap = ((esc as { context_snapshot?: Record<string, unknown> | null }).context_snapshot ?? {}) as Record<string, unknown>;
    const deliveredId = typeof snap.delivered_message_id === "string" ? snap.delivered_message_id : null;
    let apagada = false;
    const convId = (esc as { conversation_id: string | null }).conversation_id;
    if (deliveredId && convId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: conv } = await supabaseAdmin
        .from("property_chat_conversations")
        .select("guest_session_id, property_id")
        .eq("id", convId)
        .maybeSingle();
      await supabaseAdmin.from("property_chat_messages").delete().eq("id", deliveredId).eq("conversation_id", convId);
      apagada = true;
      const session = String((conv as { guest_session_id?: string | null } | null)?.guest_session_id ?? "");
      if (session.startsWith("airbnb:")) {
        try {
          const { deliverToAirbnbThread } = await import("@/lib/channex-messages.server");
          await deliverToAirbnbThread(supabaseAdmin, {
            conversationId: convId,
            threadId: session.slice("airbnb:".length),
            propertyId: String((conv as { property_id?: string }).property_id ?? ""),
            text: "Retificando minha mensagem anterior: por favor, desconsidere-a. Já te retorno com a informação correta.",
            senderType: "ai",
          });
        } catch (e) {
          console.error("[supervision] retificação Airbnb falhou", (e as Error)?.message);
        }
      }
      delete snap.delivered_message_id;
    }

    const { error: rErr } = await context.supabase
      .from("ai_human_escalations")
      .update({ status: "pending", human_response: null, resolved_at: null, applied_to_guest: false, context_snapshot: snap } as never)
      .eq("id", data.escalationId);
    if (rErr) throw new Error(rErr.message);
    return { ok: true, apagada };
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
