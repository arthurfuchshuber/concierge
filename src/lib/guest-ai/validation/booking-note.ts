/**
 * Mensagem escrita no ato da reserva (casos Simone e Felipe, 17/11/2026).
 *
 * No Airbnb, quem reserva costuma deixar uma nota ao anfitrião (motivo da viagem, quem vem, que vai cumprir as
 * regras, um boa-noite). A confirmação da plataforma e as mensagens programadas da conta já fazem a recepção; a
 * nota sem pergunta nem pedido não pede resposta. O roteiro já manda silenciar; esta trava, em código, garante:
 * dentro da janela da reserva recém-feita (`stay.bookedMinutesAgo`, só preenchido nas primeiras 3 h), uma resposta
 * cuja própria decisão diz que o hóspede não perguntou, não pediu e não alterou nada vira silêncio.
 *
 * Nunca silencia: pergunta (qualquer `?` na mensagem atual, inclusive "tudo bem?"), mídia, pedido, problema, emergência, alteração formal
 * (inclui anunciar algo que muda as condições, como pet ou mais pessoas), encaminhamento, compromisso,
 * credencial ou marco de hospitalidade. Função pura.
 */
import { decisionSignals, type ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { HistoryResult } from "@/lib/guest-ai/history";

const NOTE_ONLY_INTENTS = new Set(["acknowledgment", "other"]);


/** Mensagens do hóspede que formam o turno atual (as últimas, depois da última fala de outra pessoa). */
function currentGuestEntries(history: HistoryResult) {
  if (!history || history.status !== "available") return [];
  const out = [];
  for (let i = history.entries.length - 1; i >= 0; i--) {
    const e = history.entries[i]!;
    if (e.speaker !== "guest") break;
    out.push(e);
  }
  return out;
}

export function bookingNoteSilence(
  d: ModelDecision,
  p: { bookedMinutesAgo: number | null | undefined; history: HistoryResult },
): ModelDecision {
  if (typeof p.bookedMinutesAgo !== "number") return d;
  // contrato sem `shouldReply` (v1) não admite silêncio
  if (d.shouldReply === undefined || d.strategy === "silence" || d.reply.trim().length === 0) return d;
  const sig = decisionSignals(d);
  if (sig.intents.length === 0 || !sig.intents.every((i) => NOTE_ONLY_INTENTS.has(i))) return d;
  if (d.handoff.needed || d.commitments.length > 0 || d.credentialIntent !== "none") return d;
  if (sig.formalChangeRequests.length > 0 || sig.hospitalityMilestone !== null) return d;
  const current = currentGuestEntries(p.history);
  if (current.length === 0) return d;
  if (current.some((e) => e.media !== null || e.text.includes("?"))) return d;
  return {
    ...d,
    strategy: "silence",
    reply: "",
    shouldReply: false,
    ...(d.commitmentKinds ? { commitmentKinds: [] } : {}),
  };
}
