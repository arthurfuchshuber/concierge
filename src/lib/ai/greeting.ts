/**
 * Garante que a primeira resposta da IA numa conversa cumprimente o hóspede,
 * e que volte a cumprimentar (de forma simples) quando a conversa ficou parada
 * por bastante tempo.
 */
const GREETING_RE =
  /^\s*[¡!]?\s*(ol[aá]|oi+\b|bom dia|boa tarde|boa noite|seja bem|sejam bem|bem[- ]vind[oa]s?|hello|hi\b|hey\b|good (morning|afternoon|evening)|welcome|hola|buen[oa]s|bienvenid[oa]s?)/i;

/** Pausa a partir da qual a IA cumprimenta de novo, como numa conversa normal. */
export const REGREET_AFTER_MS = 3 * 60 * 60 * 1000;

type Msg = { role: string; content: string; at?: string | null };

export function hasGreeting(text: string): boolean {
  return GREETING_RE.test(text);
}

function firstName(name: string | null): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (!n || /^h[oó]spede$/i.test(n) || /teste/i.test(n)) return "";
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function periodOfDay(now: Date): "m" | "t" | "n" {
  const h = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(now),
  ) % 24;
  return h < 12 && h >= 5 ? "m" : h < 18 && h >= 12 ? "t" : "n";
}

/** `seed` varia a forma (determinístico); 0 = forma clássica "Olá, Nome! Boa tarde!". */
export function greetingFor(
  language: string | null | undefined,
  name: string | null,
  now = new Date(),
  seed = 0,
): string {
  const fn = firstName(name);
  const p = periodOfDay(now);
  const pick = <T,>(arr: T[]) => arr[Math.abs(Math.trunc(seed)) % arr.length];
  if (language?.startsWith("en")) {
    const g = p === "m" ? "Good morning" : p === "t" ? "Good afternoon" : "Good evening";
    return fn
      ? pick([`Hi, ${fn}! ${g}!`, `${g}, ${fn}!`, `Hey ${fn}!`, `Hello, ${fn}!`])
      : pick([`Hi! ${g}!`, `${g}!`, `Hello!`]);
  }
  if (language?.startsWith("es")) {
    const g = p === "m" ? "¡Buenos días!" : p === "t" ? "¡Buenas tardes!" : "¡Buenas noches!";
    const g2 = g.replace(/[¡!]/g, "");
    return fn
      ? pick([`¡Hola, ${fn}! ${g}`, `¡${g2}, ${fn}!`, `¡Hola, ${fn}!`])
      : pick([`¡Hola! ${g}`, g, `¡Hola!`]);
  }
  const g = p === "m" ? "Bom dia!" : p === "t" ? "Boa tarde!" : "Boa noite!";
  const g2 = g.replace("!", "");
  return fn
    ? pick([`Olá, ${fn}! ${g}`, `${g2}, ${fn}!`, `Oi, ${fn}! ${g}`, `Oi, ${fn}, tudo bem?`, `Olá, ${fn}!`])
    : pick([`Olá! ${g}`, g, `Oi! ${g}`, `Olá!`]);
}

/** Saudação curta de retomada ("Olá, Ana!" / "Oi, Ana!"), sem boas-vindas. */
export function shortGreeting(language: string | null | undefined, name: string | null, seed = 0): string {
  const fn = firstName(name);
  const i = Math.abs(Math.trunc(seed)) % 2;
  if (language?.startsWith("en")) return fn ? (i ? `Hi, ${fn}!` : `Hello, ${fn}!`) : "Hi!";
  if (language?.startsWith("es")) return fn ? `¡Hola, ${fn}!` : "¡Hola!";
  return fn ? (i ? `Oi, ${fn}!` : `Olá, ${fn}!`) : i ? "Oi!" : "Olá!";
}

/** Milissegundos desde a última fala nossa (IA ou equipe) com horário conhecido. */
function msSinceLastOurs(history: Msg[], now: Date): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]!;
    if (m.role === "user") continue;
    if (!m.at) return null;
    const t = Date.parse(m.at);
    return Number.isFinite(t) ? now.getTime() - t : null;
  }
  return null;
}

export function ensureGreeting(
  reply: string,
  history: Msg[],
  guestName: string | null,
  language: string | null | undefined,
  now = new Date(),
  force = false,
): string {
  if (!reply.trim() || hasGreeting(reply) || /\[SILENCIO\]/i.test(reply)) return reply;
  const seed = history.length + (guestName?.length ?? 0);
  // Conversa parada há horas: retoma com um "Olá, Nome!" simples.
  const gap = msSinceLastOurs(history, now);
  if (gap !== null && gap >= REGREET_AFTER_MS) return `${shortGreeting(language, guestName, seed)} ${reply}`;
  // Saudação recente (IA ou humano da equipe) nas últimas falas: nunca repete,
  // nem no retorno após decisão da equipe.
  const recentGreeted = history.slice(-6).some((m) => m.role !== "user" && hasGreeting(m.content));
  if (recentGreeted) return reply;
  // Qualquer resposta anterior do assistente já abriu a conversa: não cumprimenta de novo.
  const alreadyAnswered = history.some((m) => m.role === "assistant" && m.content.trim());
  if (alreadyAnswered && !force) return reply;
  return `${greetingFor(language, guestName, now, seed)} ${reply}`;
}

const COURTESY_RE =
  /^(?:(?:muito|mto|mt|mtt|super)\s+)?(?:obrigad[oa]s?|obg|brigad[oa]|valeu|vlw|imagina|de nada|por nada|nós que agradecemos|eu que agradeço|igualmente|amém|amem|show|top|perfeito|ótimo|otimo|beleza|blz|ok|okay|combinado|certo|tá bom|ta bom|thanks?|thank you|gracias)(?:\s+(?:n[óo]s|voc[eê]s?|vc|vcs|tb|tamb[eé]m|a voc[eê]s?|pra voc[eê]s?|demais|mesmo))*$/i;
const CLOSING_RE =
  /(obrigad|agrade[cç]|por nada|de nada|boa semana|bom descanso|boa viagem|boa noite|bom dia|boa tarde|aproveit|ótima estadia|otima estadia|até mais|qualquer coisa|disponha)/i;

/** Hóspede só retribuindo cortesia depois que já agradecemos/encerramos → silêncio. */
export function isCourtesyEcho(guestMessage: string, history: Msg[]): boolean {
  const clean = guestMessage
    .toLowerCase()
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, " ")
    .replace(/[!.,;:?❤️🙏]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean && !COURTESY_RE.test(clean)) return false;
  const lastOurs = [...history].reverse().find((m) => m.role !== "user" && m.content.trim());
  if (!lastOurs) return false;
  const text = lastOurs.content.replace(/^\[Mensagem da equipe humana do anfitrião\]:\s*/, "");
  return !text.includes("?") && CLOSING_RE.test(text);
}
