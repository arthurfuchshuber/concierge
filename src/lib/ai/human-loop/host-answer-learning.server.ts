/**
 * Resposta do anfitrião DIRETO no Airbnb a uma dúvida factual da IA.
 *
 * A pergunta original sai da tela (já respondida), e nasce um cartão no mesmo
 * formato "A IA está te perguntando", com a resposta mapeada pré-preenchida e
 * editável + "Salvar como conhecimento? / Onde vale?". Nada é salvo nem dito
 * ao hóspede sem o clique da equipe (`host_learning` é sempre silencioso).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDecisionSpec, canBecomeKnowledge } from "./decision-options";

type OpenAsk = {
  id: string;
  owner_id: string | null;
  property_id: string | null;
  agent_type: string | null;
  guest_name: string | null;
  question_to_human: string | null;
  context_snapshot: Record<string, unknown> | null;
};

/** Só dúvidas factuais (não operacionais, não proativas, não já de aprendizado). */
export function isLearnableAsk(a: Pick<OpenAsk, "context_snapshot">): boolean {
  const snap = a.context_snapshot ?? {};
  if (snap.proactive || snap.host_learning) return false;
  const spec = readDecisionSpec(snap);
  return !spec || canBecomeKnowledge(spec.kind);
}

/** Só escalações RECENTES podem ser "respondidas" pela fala do anfitrião (23/10/2026). */
export const HOST_ANSWER_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Fala rotineira do atendente — saudação, agradecimento, desculpa, link do
 * guia, instruções de check-in/check-out — nunca é conhecimento a aprender
 * (Lovable #2, 23/10/2026). Pura.
 */
export function isRoutineHostScript(text: string): boolean {
  const s = String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!s) return true;
  const short = s.length <= 90;
  if (short && /\b(ola|oi|bom dia|boa tarde|boa noite|bem[- ]vind\w*|obrigad\w*|agradec\w*|valeu|de nada|disponha|desculp\w*|perdao|sinto muito|lamento|abracos?|ate (logo|breve|amanha)|qualquer coisa|fico a disposicao|estamos a disposicao)\b/.test(s)) return true;
  if (/\b(guia digital|link do guia|acesse o guia|acessar o guia)\b/.test(s)) return true;
  if (/https?:\/\/\S*(guia|guide|concierge)/.test(s)) return true;
  if (/\b(check-?in|check-?out|checkin|checkout)\b/.test(s) && /\b(instrucoes?|passo a passo|chegada|saida|horario|a partir das|ate as|deixe|deixar|feche|fechar|retire|retirar|nos avise|avise)\b/.test(s)) return true;
  return false;
}

export async function offerHostAnswerLearning(
  admin: SupabaseClient,
  opts: { conversationId: string; hostText: string; openAsks: OpenAsk[] },
): Promise<string | null> {
  const ask = opts.openAsks.find(isLearnableAsk);
  const hostText = opts.hostText.trim();
  if (!ask || !ask.owner_id || hostText.length < 3) return null;
  // Script rotineiro (saudação, desculpa, check-in/out, link do guia): nada a aprender.
  if (isRoutineHostScript(hostText)) return null;

  let draft: string;
  let propertyName: string | null = null;
  if (ask.property_id) {
    const { data: p } = await admin.from("properties").select("name").eq("id", ask.property_id).maybeSingle();
    propertyName = (p as { name?: string } | null)?.name ?? null;
  }
  // Respeita ESTRITAMENTE a destilação: null, shouldLearn !== true ou sem
  // memória proposta = ABORTA, sem card. Não há mais fallback "rascunho = fala
  // do anfitrião" (era ele que criava cards de saudações e scripts).
  try {
    const { distillHumanDecision } = await import("./learning.server");
    const d = await distillHumanDecision({
      question: ask.question_to_human ?? "",
      humanAnswer: hostText,
      agent: ask.agent_type ?? undefined,
      propertyName,
    });
    if (!d || d.shouldLearn !== true || !d.proposedMemory?.trim()) return null;
    draft = d.proposedMemory;
  } catch (e) {
    console.error("[host-learning] destilação falhou; nada a aprender", (e as Error)?.message);
    return null;
  }

  const { data: ins, error } = await admin
    .from("ai_human_escalations")
    .insert({
      owner_id: ask.owner_id,
      tenant_id: ask.owner_id,
      property_id: ask.property_id,
      conversation_id: opts.conversationId,
      guest_name: ask.guest_name,
      agent_type: ask.agent_type ?? "concierge",
      trigger: "low_confidence",
      reason: "host_answer_learning",
      question_to_human: `Você respondeu direto no Airbnb: "${ask.question_to_human ?? ""}". Confira a resposta abaixo e diga se devo aprender.`.slice(0, 1200),
      status: "pending",
      context_snapshot: {
        decision: { kind: "fact", options: [] },
        proactive: true,
        host_learning: true,
        draft: draft.slice(0, 2000),
        source_escalation_id: ask.id,
      } as never,
    } as never)
    .select("id")
    .single();
  if (error) throw error;

  try {
    if (ask.property_id) {
      const { getPropertyNotifiableUsers, sendHandoffPush } = await import("@/lib/handoff.server");
      const ids = await getPropertyNotifiableUsers(admin as never, ask.property_id);
      await sendHandoffPush(admin as never, {
        userIds: ids,
        conversationId: opts.conversationId,
        propertyName,
        guestName: ask.guest_name,
        guestMessage: draft,
        checkinDate: null,
        reason: "Confirme se a IA deve aprender a sua resposta",
        urgency: "low",
      });
    }
  } catch (e) {
    console.error("[host-learning] push falhou", (e as Error)?.message);
  }
  return (ins as { id?: string } | null)?.id ?? null;
}
