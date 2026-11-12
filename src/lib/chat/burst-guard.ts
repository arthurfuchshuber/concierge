/**
 * RAJADA E DUPLICATA NO AIRBNB (12/11/2026, diretiva de coerência — casos Tais e Ary). Puro.
 *
 * 1. Coalescência: a Channex manda um webhook por mensagem; com mensagens picadas ("Oie" → "Bom dia" →
 *    "Dia 18 vc tem disponibilidade?") cada uma gerava a própria resposta. Agora o webhook espera uma janela curta
 *    de respiro (`AIRBNB_BURST_QUIET_MS`) e, se o hóspede já mandou outra mensagem, a intermediária não gera
 *    resposta avulsa: a mais nova responde o bloco (as mensagens seguidas do hóspede viram um único turno). O mesmo
 *    vale depois da geração: se chegou mensagem nova enquanto a IA pensava, a resposta antiga não é entregue.
 * 2. Trava de duplicata: a IA nunca entrega ao Airbnb o MESMO texto que a última mensagem nossa da conversa, se
 *    ela foi gravada há menos de `DUPLICATE_REPLY_WINDOW_MS`.
 */

/** Janela de respiro antes de chamar a IA no Airbnb. */
export const AIRBNB_BURST_QUIET_MS = 4_000;
/** Mesma resposta da IA dentro desta janela ⇒ não reenvia. */
export const DUPLICATE_REPLY_WINDOW_MS = 60_000;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** A última mensagem nossa da conversa tem exatamente o mesmo texto, gravada há menos de 60 s? */
export function isDuplicateRecentReply(
  last: { content: string | null; created_at: string | null } | null | undefined,
  text: string,
  nowMs: number,
  windowMs = DUPLICATE_REPLY_WINDOW_MS,
): boolean {
  if (!last?.content || !last.created_at) return false;
  const at = Date.parse(last.created_at);
  if (!Number.isFinite(at) || nowMs - at > windowMs || nowMs < at - 5_000) return false;
  return squash(last.content) === squash(text) && squash(text).length > 0;
}
