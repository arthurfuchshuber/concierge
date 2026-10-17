/**
 * RASCUNHO PARA A EQUIPE NO HANDOFF (17/10/2026, ponto 1 aprovado).
 *
 * Quando a IA aciona a equipe, ela já entrega o caso mastigado: resumo, o que
 * já foi tentado/informado e uma resposta SUGERIDA ao hóspede (a equipe edita
 * ou envia). O que a equipe altera vira o melhor material de aprendizado de tom.
 *
 * Nunca lança e nunca bloqueia o handoff: se o modelo falhar, sai um rascunho
 * determinístico (últimas falas do hóspede + o que a IA já respondeu).
 * A resposta sugerida NÃO promete prazo nem ação que ninguém confirmou.
 */
import { chatJson, EMPTY_USAGE, type Usage } from "../gateway.server";

export type HandoffDraft = {
  summary: string;
  tried: string;
  suggestedReply: string;
  usage: Usage;
};

type Turn = { role: string; content: string };

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function fallbackDraft(history: Turn[], guestMessage: string, reason: string): Omit<HandoffDraft, "usage"> {
  const guestLast = [...history.filter((m) => m.role === "user").map((m) => m.content), guestMessage].slice(-3);
  const ai = history.filter((m) => m.role === "assistant").slice(-1)[0]?.content ?? "";
  return {
    summary: clip(`Hóspede: ${guestLast.join(" / ")}. Motivo do acionamento: ${reason}`, 380),
    tried: ai ? clip(`Última orientação da IA: ${ai}`, 240) : "A IA ainda não havia orientado o hóspede.",
    suggestedReply: "",
  };
}

export async function buildHandoffDraft(params: {
  history: Turn[];
  guestMessage: string;
  reason: string;
  language?: string | null;
}): Promise<HandoffDraft> {
  const base = fallbackDraft(params.history, params.guestMessage, params.reason);
  try {
    const convo = [...params.history.slice(-8), { role: "user", content: params.guestMessage }]
      .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${clip(m.content, 400)}`)
      .join("\n");
    const { data, usage } = await chatJson<{ summary?: string; tried?: string; suggestedReply?: string }>("intent", [
      {
        role: "system",
        content:
          "Você prepara o caso para a equipe de um imóvel de hospedagem assumir uma conversa. " +
          'Responda APENAS JSON: {"summary":"...","tried":"...","suggestedReply":"..."}. ' +
          "summary: 1 a 2 frases objetivas sobre o que o hóspede precisa. " +
          "tried: o que a IA já informou ou verificou (ou 'nada ainda'). " +
          "suggestedReply: rascunho curto, caloroso e educado, no idioma do hóspede, para a equipe enviar. " +
          "NÃO invente fatos, valores, horários, prazos nem códigos; se faltar decisão da equipe, deixe um trecho entre [colchetes] para ela completar. " +
          "Não prometa ação sua ('vou verificar'). Sem gíria; emoji só se o hóspede usou.",
      },
      { role: "user", content: `Idioma: ${params.language ?? "pt"}\nMotivo: ${params.reason}\n\nConversa:\n${convo}` },
    ]);
    return {
      summary: clip(String(data?.summary ?? "").trim() || base.summary, 380),
      tried: clip(String(data?.tried ?? "").trim() || base.tried, 240),
      suggestedReply: clip(String(data?.suggestedReply ?? "").trim(), 360),
      usage,
    };
  } catch {
    return { ...base, usage: EMPTY_USAGE };
  }
}

/** Texto final gravado em `question_to_human` (limite de 1200 do escalonamento). */
export function formatDraftForTeam(reason: string, d: Omit<HandoffDraft, "usage">): string {
  const parts = [
    clip(reason.replace(/^\[[^\]]+\]\s*/, ""), 300),
    d.summary && `Resumo: ${d.summary}`,
    d.tried && `Já feito pela IA: ${d.tried}`,
    d.suggestedReply && `Sugestão de resposta: ${d.suggestedReply}`,
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 1200);
}
