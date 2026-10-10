/** Token que a IA devolve quando a mensagem do hóspede não pede resposta. */
export const SILENCE_TOKEN = "[SILENCIO]";

const LEGACY_SIGNATURE = /\n*_?\[Assistente IA\]_?\s*$/;

/**
 * Finaliza a resposta da IA: silêncio vira string vazia (nada é enviado).
 * Sem assinatura (removida a pedido do anfitrião; o Airbnb já indica envio por software).
 */
export function finalizeAgentReply(reply: string, channel: string | undefined | null): string {
  const text = (reply ?? "").trim();
  if (!text || (text.replace(/[\s.]/g, "").toUpperCase().includes("[SILENCIO]") && text.length < 40)) return "";
  void channel;
  return text.replace(LEGACY_SIGNATURE, "").trim();
}
