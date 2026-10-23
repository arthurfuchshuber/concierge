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

const CONFIRMED_STAY = /\s*(?:a\s+)?(?:sua|seu|a|o)\s+(?:sa[ií]da|check-?out|check-?in|entrada)\s+(?:est[aá]|foi)\s+(?:confirmad[oa]|registrad[oa])[.!]?|\s*(?:Confirmamos|Registramos)\s+(?:a\s+|o\s+)?(?:sua\s+|seu\s+)?(?:sa[ií]da|check-?out|check-?in|entrada)[.!]?|\s*(?:Sa[ií]da|Check-?out|Check-?in)\s+confirmad[oa][.!]?/gi;

/** Remove anúncios burocráticos de "saída confirmada" (pedido do anfitrião). */
export function stripStayConfirmation(text: string): string {
  if (!CONFIRMED_STAY.test(text)) return text;
  CONFIRMED_STAY.lastIndex = 0;
  return text.replace(CONFIRMED_STAY, (m, off: number, all: string) => {
    const before = all.slice(0, off).trimEnd();
    return /[!.?]$/.test(before) || before === "" ? "" : ".";
  }).replace(/^\s+/, "").replace(/[ \t]+\n/g, "\n");
}

type LineKind = "blank" | "dash" | "num" | "cont" | "text";

/**
 * Normalização determinística de listas (mesmo se o modelo oscilar):
 * - itens com hífen ("- ") sempre separados por linha em branco;
 * - itens numerados ("1. ") ficam juntos, sem linha em branco entre eles;
 * - linha em branco entre a lista e os parágrafos ao redor.
 * Linhas indentadas logo após um item são continuação dele e não são separadas.
 */
export function formatListSpacing(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let prev: LineKind | null = null; // último tipo não vazio
  let sawBlank = false;
  let lastListKind: "dash" | "num" = "dash";
  for (const raw of lines) {
    const line = raw.replace(/[ \t]+$/, "");
    if (!line.trim()) {
      sawBlank = true;
      continue;
    }
    const inList = prev === "dash" || prev === "num" || (prev === "cont");
    let kind: LineKind = /^\s*-\s+\S/.test(line) ? "dash" : /^\s*\d+[.)]\s+\S/.test(line) ? "num" : "text";
    if (kind === "text" && inList && !sawBlank && /^\s+/.test(line)) kind = "cont";
    let sep = "";
    if (prev !== null) {
      if (kind === "cont") sep = "\n";
      else if (kind === "dash") sep = "\n\n";
      else if (kind === "num") sep = prev === "num" || (prev === "cont" && lastListKind === "num") ? "\n" : "\n\n";
      else sep = inList ? "\n\n" : sawBlank ? "\n\n" : "\n";
    }
    if (kind === "dash" || kind === "num") lastListKind = kind;
    out.push(sep + line);
    prev = kind;
    sawBlank = false;
  }
  return out.join("");
}
export function finalizeAgentReply(reply: string, channel: string | undefined | null): string {
  const text = (reply ?? "").trim();
  if (!text || (text.replace(/[\s.]/g, "").toUpperCase().includes("[SILENCIO]") && text.length < 40)) return "";
  void channel;
  return formatListSpacing(redactHostMoney(stripStayConfirmation(text.replace(LEGACY_SIGNATURE, "").trim())));
}
