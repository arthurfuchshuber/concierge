/**
 * Reconciliação de incoerências BENIGNAS da decisão do modelo (09/11/2026).
 *
 * Antes, um campo fora de combinação (ex.: `strategy: "silence"` mas com texto de resposta, ou pergunta à equipe
 * sem `needed`) derrubava o turno inteiro em `structural_block` e o hóspede ficava sem sugestão. Aqui o sistema
 * conserta só o que é inequívoco e NÃO muda segurança: não toca credenciais, compromissos, fundamento, posse
 * humana, marcos nem alteração formal (esses seguem bloqueio duro no validador). Função pura.
 */
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";

export function reconcileDecision(d: ModelDecision): ModelDecision {
  let r: ModelDecision = d;
  const has = d.reply.trim().length > 0;

  // 1) Texto de resposta presente ⇒ é resposta (nunca descartar texto pronto por rótulo de silêncio inconsistente).
  if (has && (d.strategy === "silence" || d.shouldReply === false)) {
    r = {
      ...r,
      strategy: d.strategy === "silence" ? "answer" : d.strategy,
      ...(d.shouldReply === undefined ? {} : { shouldReply: true }),
    };
  }

  // 2) Pergunta/urgência à equipe sem encaminhamento: descarta os campos soltos.
  if (!r.handoff.needed && (r.handoff.question !== null || r.handoff.urgency !== null)) {
    const strategyWantsHandoff = r.strategy === "handoff" || r.strategy === "answer_and_handoff";
    if (strategyWantsHandoff && r.handoff.question) {
      r = { ...r, handoff: { ...r.handoff, needed: true } };
    } else {
      r = { ...r, handoff: { needed: false, question: null, urgency: null } };
    }
  }

  // 3) Encaminhamento declarado (com pergunta) mas estratégia sem encaminhamento.
  const wants = r.strategy === "handoff" || r.strategy === "answer_and_handoff";
  if (r.handoff.needed && r.handoff.question && !wants && r.strategy !== "silence") {
    r = { ...r, strategy: r.reply.trim() ? "answer_and_handoff" : "handoff" };
  }
  return r;
}
