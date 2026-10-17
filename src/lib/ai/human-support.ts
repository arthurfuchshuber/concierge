/**
 * QUANDO A RESPOSTA DEPENDE DE UM HUMANO (17/10/2026, regra do anfitrião).
 *
 * Nada de "vou confirmar isso e já te respondo": a IA não promete retorno.
 * - Primeira fala da IA na conversa: só a saudação.
 * - Já cumprimentou antes: silêncio no chat (a equipe é acionada no painel).
 */
import { greetingFor, hasGreeting } from "./greeting";
import { SILENCE_TOKEN } from "./reply-finalize";

const PROMISE =
  /\b(vou|irei|deixa(?:-me)? eu|estou|t[ôo]|j[áa] vou)\s+(confirmar|checar|verificar|conferir|consultar|ver|validar|confirmando|checando|verificando|conferindo|consultando)\b|\bj[áa]\s+te\s+(respondo|retorno|aviso|falo|digo)\b|\b(let me|i'?ll|i am|i'm)\s+(confirm|check|look into|verify|checking|confirming)\b|\b(voy a|d[ée]jame|lo estoy|estoy)\s+(confirmar|revisar|verificar|revisando|confirmando|verificando)\b/i;

/** Remove as frases que prometem confirmar/retornar. */
export function stripPromiseSentences(text: string): string {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => !PROMISE.test(s))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Resposta ao hóspede quando só um humano pode decidir. */
export function humanSupportReply(
  history: Array<{ role: string; content: string }>,
  guestName: string | null,
  language: string | null | undefined,
  now = new Date(),
): string {
  const alreadySpoke = history.some((m) => m.role === "assistant" && m.content.trim());
  return alreadySpoke ? SILENCE_TOKEN : greetingFor(language, guestName, now);
}

/** O texto é só cumprimento (ex.: "Olá, Fernanda! Bom dia!")? */
export function isOnlyGreeting(text: string): boolean {
  const partes = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  return partes.length > 0 && partes.every((x) => hasGreeting(x) && x.length <= 40);
}
