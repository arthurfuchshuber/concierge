/** Token que a IA devolve quando a mensagem do hóspede não pede resposta. */
export const SILENCE_TOKEN = "[SILENCIO]";

export const AI_SIGNATURE = "[Assistente IA]";

/**
 * Finaliza a resposta da IA: silêncio vira string vazia (nada é enviado) e
 * respostas reais recebem a assinatura. Airbnb não aceita formatação → texto
 * puro; Guia e WhatsApp → itálico.
 */
export function finalizeAgentReply(reply: string, channel: string | undefined | null): string {
  const text = (reply ?? "").trim();
  if (!text || (text.replace(/[\s.]/g, "").toUpperCase().includes("[SILENCIO]") && text.length < 40)) return "";
  if (channel === "evaluation") return text;
  if (text.includes(AI_SIGNATURE)) return text;
  const sig = channel === "airbnb" ? AI_SIGNATURE : `_${AI_SIGNATURE}_`;
  return `${text}\n\n${sig}`;
}
