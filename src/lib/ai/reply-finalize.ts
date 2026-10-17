/** Token que a IA devolve quando a mensagem do hóspede não pede resposta. */
export const SILENCE_TOKEN = "[SILENCIO]";

const LEGACY_SIGNATURE = /\n*_?\[Assistente IA\]_?\s*$/;

/**
 * Finaliza a resposta da IA: silêncio vira string vazia (nada é enviado).
 * Sem assinatura (removida a pedido do anfitrião; o Airbnb já indica envio por software).
 */
/**
 * Trava determinística (além do prompt): o hóspede só vê o valor bruto. Qualquer frase que cite
 * comissão, taxa de serviço do anfitrião, repasse/valor líquido ou co-anfitrião é removida.
 */
const HOST_MONEY =
  /comiss[aã]o|taxa de servi[cç]o do anfitri|repasse|valor l[ií]quido|l[ií]quido que (?:eu )?recebo|quanto (?:o )?anfitri[aã]o recebe|ganho do anfitri|co-?anfitri[aã]o.{0,40}(?:recebe|paga|valor|repasse)|payout/i;
export const HOST_MONEY_FALLBACK = "Posso te ajudar com o valor total da sua reserva, que é o que consta na sua reserva no Airbnb.";

export function redactHostMoney(text: string): string {
  if (!HOST_MONEY.test(text)) return text;
  const parts = text.split(/(?<=[.!?\n])\s+/).filter((sentence) => !HOST_MONEY.test(sentence));
  const out = parts.join(" ").trim();
  return out || HOST_MONEY_FALLBACK;
}

export function finalizeAgentReply(reply: string, channel: string | undefined | null): string {
  const text = (reply ?? "").trim();
  if (!text || (text.replace(/[\s.]/g, "").toUpperCase().includes("[SILENCIO]") && text.length < 40)) return "";
  void channel;
  return redactHostMoney(text.replace(LEGACY_SIGNATURE, "").trim());
}
