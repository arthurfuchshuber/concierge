/**
 * SILÊNCIO GARANTIDO EM CONFIRMAÇÃO/CORTESIA SEM CONTEXTO (titular, 10/11/2026 — caso Karen: um "Sim" solto,
 * primeira mensagem da conversa, recebeu um texto institucional). Regra em CÓDIGO, acima do modelo:
 * se o turno do hóspede é só confirmação ou cortesia ("Sim", "Ok", "Obrigado", emoji…) e a nossa última mensagem
 * (IA, equipe ou sistema) não fez pergunta — ou não existe mensagem nossa —, a IA não responde.
 * Com pergunta nossa pendente ("Quer que eu envie o passo a passo?" → "Sim"), a conversa segue. Puro.
 */
import type { HistoryEntry } from "@/lib/guest-ai/history";

const ACK_PHRASES = new Set([
  "sim", "s", "ss", "ok", "okay", "okk", "oks", "blz", "beleza", "certo", "certinho", "combinado", "perfeito", "obrigado",
  "obrigada", "obg", "brigado", "brigada", "muito obrigado", "muito obrigada", "valeu", "vlw", "entendi", "entendido",
  "tudo bem", "tudo certo", "ta", "ta bom", "ta certo", "ta otimo", "esta bem", "esta bom", "bom", "otimo", "show", "joia", "legal", "claro",
  "maravilha", "tranquilo", "fechado", "top", "de nada", "por nada", "isso", "isso mesmo", "pode ser", "ok obrigado",
  "ok obrigada", "sim obrigado", "sim obrigada", "certo obrigado", "certo obrigada", "perfeito obrigado", "perfeito obrigada",
  "yes", "yep", "yeah", "thanks", "thank you", "thx", "great", "perfect", "sure", "got it", "alright", "all good", "ok thanks",
  "si", "vale", "gracias", "muchas gracias", "perfecto", "claro que si", "de acuerdo",
]);

/** Minúsculas, sem acento, sem pontuação/emoji, espaços únicos. */
export function normalizeAck(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Só confirmação/cortesia (ou só emoji/pontuação)? Pergunta, número ou qualquer outra palavra ⇒ não. */
export function isBareAcknowledgment(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 40) return false;
  const n = normalizeAck(raw);
  if (n === "") return true; // só emoji/pontuação (👍, 🙏, "!")
  return ACK_PHRASES.has(n);
}

const AFFIRMATIVE_OPENERS = /^(sim|isso|isso mesmo|ok|certo|exato|exatamente|correto|confirmo|confirmado|claro|perfeito)\b/;
const REQUEST_WORDS =
  /\b(gostaria|queria|quero|preciso|precisamos|poderia|poderiam|pode|podem|podemos|favor|por favor|como|qual|quais|quando|onde|quanto|quantos|tem|tens|existe|aceita|aceitam|problema|nao funciona|nao consigo|nao abre|ajuda|socorro)\b/;

const TIME_MENTION = /\b\d{1,2}\s?(h|hs|hrs?|horas?|am|pm)\b|\b\d{1,2} \d{2}\b|\bas \d{1,2}\b/;

/**
 * Resposta afirmativa com conteúdo a uma pergunta que não está nesta conversa ("Sim! Estou reservado para meu
 * marido e 2 amigos…", caso Karen 11/11/2026): abre com afirmação, não pergunta nem pede nada. Sem pergunta nossa
 * pendente, a IA não tem o que responder; o fato segue lido pelos bastidores (cartões), que não dependem da resposta.
 */
export function isAffirmativeStatement(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 160) return false;
  const n = normalizeAck(raw);
  return AFFIRMATIVE_OPENERS.test(n) && !REQUEST_WORDS.test(n) && !TIME_MENTION.test(n);
}

/**
 * O turno atual do hóspede (mensagens seguidas dele no fim do histórico) deve ficar SEM resposta?
 * Mídia (foto/áudio) nunca é confirmação vazia.
 */
export function shouldSilenceBareAck(entries: readonly HistoryEntry[]): boolean {
  let i = entries.length - 1;
  const turn: HistoryEntry[] = [];
  while (i >= 0 && entries[i]!.speaker === "guest") turn.unshift(entries[i--]!);
  if (turn.length === 0 || turn.some((e) => e.media != null || !(isBareAcknowledgment(e.text) || isAffirmativeStatement(e.text)))) return false;
  const ours = i >= 0 ? entries[i]! : null;
  return !ours || !ours.text.includes("?");
}
