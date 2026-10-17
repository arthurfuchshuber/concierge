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

/**
 * RECONHECIMENTO COM RETORNO DA EQUIPE (17/10/2026, decisão do anfitrião).
 *
 * Vale só quando o chamado FOI criado (há id de escalonamento) e existe quem
 * receba o aviso. Calorosa, variada, no registro do hóspede, e diz que a equipe
 * retorna "por aqui assim que possível". Nunca promete ação da própria IA
 * ("vou confirmar", "estou verificando") nem prazo específico. Uma vez por
 * assunto: se a IA já reconheceu antes, fica em silêncio.
 */
const ACK_MARK = /\b(equipe|team|equipo)\b[^.!?]{0,80}\b(por aqui|here|por acá|por aca)\b/i;

export function alreadyAcknowledged(history: Array<{ role: string; content: string }>, lookback = 6): boolean {
  const ai = history.filter((m) => m.role === "assistant").slice(-lookback);
  return ai.some((m) => ACK_MARK.test(m.content));
}

export function acknowledgementReply(params: {
  history: Array<{ role: string; content: string }>;
  guestName: string | null;
  language: string | null | undefined;
  /** O chamado/escalonamento foi realmente criado? */
  ticketCreated: boolean;
  /** Existe alguém que será avisado (equipe vinculada / anfitrião)? */
  notifiable: boolean;
  formal?: boolean;
  now?: Date;
}): string {
  const { history, guestName, language, ticketCreated, notifiable } = params;
  const now = params.now ?? new Date();
  // Sem fato verificável: nada de promessa (comportamento anterior).
  if (!ticketCreated || !notifiable) return humanSupportReply(history, guestName, language, now);
  if (alreadyAcknowledged(history)) return SILENCE_TOKEN;

  const fn = (guestName ?? "").trim().split(/\s+/)[0] ?? "";
  const name = fn && !/^h[oó]spede$/i.test(fn) && !/teste/i.test(fn) ? fn.charAt(0).toUpperCase() + fn.slice(1).toLowerCase() : "";
  const seed = history.length;
  const pick = <T,>(a: T[]) => a[seed % a.length]!;
  const first = !history.some((m) => m.role === "assistant" && m.content.trim());
  const lead = first ? `${greetingFor(language, guestName, now, seed)} ` : "";
  const lang = (language ?? "pt").toLowerCase();

  let body: string;
  if (lang.startsWith("en")) {
    body = params.formal
      ? "Thank you for letting us know. Our team has been informed and will get back to you here as soon as possible."
      : pick([
          "Thanks for letting me know. The team already has all the details and will get back to you here as soon as possible.",
          "I appreciate you telling me. The team is aware and will follow up here as soon as they can.",
        ]);
  } else if (lang.startsWith("es")) {
    body = params.formal
      ? "Gracias por avisarnos. El equipo ya fue informado y le responderá por aquí lo antes posible."
      : pick([
          "Gracias por avisar. El equipo ya tiene todos los detalles y te responderá por aquí lo antes posible.",
          "Te agradezco que lo cuentes. El equipo ya está al tanto y te escribirá por aquí en cuanto pueda.",
        ]);
  } else {
    const n = name ? `, ${name}` : "";
    body = params.formal
      ? `Agradeço o aviso${n}. A equipe já foi informada e retornará por aqui assim que possível.`
      : pick([
          `Obrigada por avisar${n}. A equipe já está com todos os detalhes e vai retornar por aqui assim que possível.`,
          `Entendi${n}, e agradeço por contar. A equipe já está ciente e te responde por aqui assim que puder.`,
          `Obrigada por me contar${n}. Já passei tudo para a equipe, que retorna por aqui assim que possível.`,
        ]);
  }
  // Saudação só na 1ª fala; o resto vem logo depois.
  return `${lead}${body}`.trim();
}
