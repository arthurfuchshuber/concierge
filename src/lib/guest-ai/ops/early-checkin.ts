/**
 * ENTRADA ANTECIPADA COMBINADA COM A EQUIPE NO CHAT (puro: sem banco, rede nem relógio).
 *
 * Diretriz do titular (07/11/2026): se um atendente HUMANO combinou expressamente a entrada antecipada na
 * conversa ("pode entrar às 11h", "check-in antecipado liberado"), a confirmação de entrada do hóspede conclui
 * o card de check-in mesmo antes do horário oficial. Pedido do hóspede nunca é autorização; só mensagens da
 * equipe (`speaker = team`). A palavra mais recente da equipe sobre a entrada é a que vale.
 */
import { normalizeText } from "./lexical";

export interface EarlyCheckinHistoryEntry {
  messageId: string;
  speaker: string;
  text: string;
  at: string;
}

export const EARLY_CHECKIN_LOOKBACK_MS = 72 * 3600 * 1000;

const W = (words: string[]) => new RegExp(`(?:^|[^a-z0-9'])(?:${words.join("|")})(?=$|[^a-z0-9'])`);

const CHECKIN_CONTEXT = W([
  "check-?in",
  "entrada",
  "entrar",
  "entrem",
  "chegar",
  "chegada",
  "acesso",
  "apartamento (?:ja )?(?:esta )?(?:pronto|liberado)",
  "imovel (?:ja )?(?:esta )?(?:pronto|liberado)",
  "early",
  "check in",
  "come in",
  "arrive",
  "llegar",
  "entrar",
]);
const GRANT = W([
  "pode(?:m)? (?:entrar|chegar|fazer o check-?in|subir|acessar)",
  "podera(?:o)? (?:entrar|chegar)",
  "autorizad[oa]s?",
  "liberad[oa]s?",
  "aprovad[oa]s?",
  "confirmad[oa]s?",
  "combinado",
  "fechado",
  "pronto",
  "pode sim",
  "sem problemas?",
  "claro",
  "you can (?:come in|check in|arrive|go in)",
  "approved",
  "confirmed",
  "no problem",
  "is ready",
  "puede(?:n)? (?:entrar|llegar)",
]);
const NEGATION = W([
  "nao",
  "nem",
  "infelizmente",
  "impossivel",
  "indisponivel",
  "nunca",
  "ainda",
  "not",
  "[a-z]+n't",
  "cannot",
  "unfortunately",
  "sorry",
  "desculpe",
]);
const DEFER = W([
  "se",
  "caso",
  "vou (?:ver|verificar|confirmar|checar|consultar)",
  "vamos (?:ver|verificar|confirmar|checar)",
  "verific[a-z]*",
  "aguard[a-z]*",
  "depende",
  "talvez",
  "consult[a-z]*",
  "te aviso",
  "confirmo",
  "a confirmar",
  "if",
  "let me check",
  "will check",
  "maybe",
]);
const FEE = W(["taxa", "cobranca", "cobrar", "valor", "r\\$", "reais", "pagamento", "pagar", "pix", "fee", "charge", "pay"]);

function sentences(text: string): string[] {
  return normalizeText(text)
    .split(/(?<=[.!?;\n])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Concessão da equipe ainda válida? `messageId` da mensagem da equipe ou `null`. */
export function detectStaffEarlyCheckin(
  history: readonly EarlyCheckinHistoryEntry[],
  opts: { now: Date },
): { messageId: string } | null {
  const since = opts.now.getTime() - EARLY_CHECKIN_LOOKBACK_MS;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const e = history[i]!;
    if (e.speaker !== "team") continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at) || at > opts.now.getTime()) continue;
    if (at < since) return null;
    const about = sentences(e.text).filter((s) => CHECKIN_CONTEXT.test(s));
    if (about.length === 0) continue;
    // a palavra mais nova da equipe sobre a entrada é a que vale
    const s = about[about.length - 1]!;
    if (s.includes("?") || NEGATION.test(s) || DEFER.test(s) || FEE.test(s)) return null;
    return GRANT.test(s) ? { messageId: e.messageId } : null;
  }
  return null;
}
