/**
 * ENTREGA DURÁVEL DA RESPOSTA DA EQUIPE AO HÓSPEDE (28/10/2026).
 *
 * A IA pode levar mais de um minuto para redigir a resposta (consulta fontes,
 * disponibilidade, outros imóveis). Quando o clique da equipe caía por tempo
 * esgotado, a resposta ficava gravada mas nunca chegava ao hóspede (caso Davi,
 * Studio 101). Agora toda resposta a ser entregue fica marcada como pendente
 * (`context_snapshot.delivery`) e o cron de 1 min reenvia até 3 vezes.
 */
type Admin = any;

export const DELIVERY_RETRY_AFTER_MS = 5 * 60 * 1000;
export const DELIVERY_MAX_ATTEMPTS = 3;
const DELIVERY_LOOKBACK_MS = 6 * 60 * 60 * 1000;

export function humanAnswerInstruction(pergunta: string, answer: string): string {
  return (
    `A equipe respondeu internamente à sua pergunta "${pergunta}": "${answer}". ` +
    "Trate essa escolha como FATO verdadeiro, não como o texto a enviar. Responda como concierge de alto padrão: " +
    "releia a conversa inteira e a pergunta real do hóspede, combine a decisão com os dados reais do imóvel e da reserva " +
    "(busque nas fontes quando necessário — localização do item, instruções, horários) e conduza a conversa: " +
    "se houver próximo passo natural, ofereça-o; se a decisão liberar algo, entregue o necessário para ele agir. " +
    "Seja natural, humano e conciso, como um anfitrião de verdade: sem roteiro fixo, sem listas decoradas, sem repetir o que já foi dito e sem inventar nada fora das fontes. " +
    "Siga exatamente a decisão comercial da equipe (nunca acrescente desconto, preço ou exceção de regra que ela não decidiu). " +
    "Disponibilidade, porém, é com você: se o hóspede falou de datas e o imóvel atual não está livre no período inteiro, chame find_available_stays e, havendo outro imóvel do anfitrião livre na mesma região, sugira-o com o link oficial do anúncio que a ferramenta devolve — mesmo que a equipe não tenha citado. Nunca sugira imóvel sem link. " +
    "Com quem já se hospedou conosco, não descreva o imóvel que ele já conhece. Nunca exponha incerteza interna do sistema. " +
    "Não diga que consultou ninguém, não mencione equipe nem transferência — do ponto de vista dele, quem sempre esteve na conversa é você."
  );
}

type Delivery = { attempts: number; last_try_at: string };

export function shouldRetryDelivery(d: Delivery | null | undefined, now: number): boolean {
  if (!d) return false;
  if ((d.attempts ?? 0) >= DELIVERY_MAX_ATTEMPTS) return false;
  return now - new Date(d.last_try_at).getTime() >= DELIVERY_RETRY_AFTER_MS;
}

/**
 * Uma tentativa de entrega. A tentativa é reivindicada por chave única em
 * `ops_push_log`, então chamadas paralelas nunca enviam em dobro.
 */
export async function deliverHumanAnswer(
  admin: Admin,
  escalationId: string,
): Promise<{ sent: boolean; messageId?: string | null }> {
  const { data: esc } = await admin
    .from("ai_human_escalations")
    .select("id, owner_id, conversation_id, question_to_human, human_response, applied_to_guest, context_snapshot")
    .eq("id", escalationId)
    .maybeSingle();
  if (!esc?.conversation_id || !esc.human_response || esc.applied_to_guest) return { sent: false };
  const snap = (esc.context_snapshot ?? {}) as Record<string, unknown>;
  const prev = (snap.delivery ?? null) as Delivery | null;
  const attempt = (prev?.attempts ?? 0) + 1;
  if (attempt > DELIVERY_MAX_ATTEMPTS) return { sent: false };

  const { error: claimErr } = await admin.from("ops_push_log").insert({
    owner_id: esc.owner_id,
    kind: "human-answer-delivery",
    dedupe_key: `human-answer:${escalationId}:${attempt}`,
    payload: { escalationId, attempt },
  });
  if (claimErr) return { sent: false };

  const delivery: Delivery = { attempts: attempt, last_try_at: new Date().toISOString() };
  await admin
    .from("ai_human_escalations")
    .update({ context_snapshot: { ...snap, delivery } })
    .eq("id", escalationId);

  const { speakWithAgent } = await import("@/lib/ai/outbound/speak.server");
  const r = await speakWithAgent({
    supabase: admin as never,
    conversationId: esc.conversation_id,
    reason: "human_answer",
    pushTitle: "Resposta sobre o seu pedido",
    instruction: humanAnswerInstruction(esc.question_to_human ?? "", esc.human_response),
  });
  if (r.sent) {
    const { delivery: _done, ...rest } = { ...snap, delivery };
    await admin
      .from("ai_human_escalations")
      .update({
        applied_to_guest: true,
        context_snapshot: { ...rest, delivered_message_id: r.messageId ?? null },
      })
      .eq("id", escalationId);
  }
  return { sent: !!r.sent, messageId: r.messageId ?? null };
}

/** Cron: reenvia respostas da equipe que ficaram sem chegar ao hóspede. */
export async function retryPendingHumanAnswers(admin: Admin, limit = 5): Promise<number> {
  const now = Date.now();
  const { data: rows } = await admin
    .from("ai_human_escalations")
    .select("id, context_snapshot")
    .eq("status", "answered")
    .eq("applied_to_guest", false)
    .not("context_snapshot->delivery", "is", null)
    .gte("resolved_at", new Date(now - DELIVERY_LOOKBACK_MS).toISOString())
    .limit(50);
  let done = 0;
  for (const row of (rows ?? []) as Array<{ id: string; context_snapshot: { delivery?: Delivery } | null }>) {
    if (done >= limit) break;
    if (!shouldRetryDelivery(row.context_snapshot?.delivery, now)) continue;
    try {
      const r = await deliverHumanAnswer(admin, row.id);
      if (r.sent) done += 1;
    } catch (e) {
      console.error("[deliver-answer] reenvio falhou", row.id, (e as Error)?.message);
    }
  }
  return done;
}
