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

export async function offerHostAnswerLearning(
  admin: SupabaseClient,
  opts: { conversationId: string; hostText: string; openAsks: OpenAsk[] },
): Promise<string | null> {
  const ask = opts.openAsks.find(isLearnableAsk);
  const hostText = opts.hostText.trim();
  if (!ask || !ask.owner_id || hostText.length < 3) return null;

  let draft = hostText;
  let propertyName: string | null = null;
  if (ask.property_id) {
    const { data: p } = await admin.from("properties").select("name").eq("id", ask.property_id).maybeSingle();
    propertyName = (p as { name?: string } | null)?.name ?? null;
  }
  try {
    const { distillHumanDecision } = await import("./learning.server");
    const d = await distillHumanDecision({
      question: ask.question_to_human ?? "",
      humanAnswer: hostText,
      agent: ask.agent_type ?? undefined,
      propertyName,
    });
    if (d?.proposedMemory) draft = d.proposedMemory;
  } catch {
    /* rascunho cai para o texto do anfitrião */
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
