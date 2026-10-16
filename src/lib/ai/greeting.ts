/**
 * Garante que a primeira resposta da IA numa conversa cumprimente o hóspede.
 * Se nenhuma mensagem anterior do assistente cumprimentou, e a resposta atual
 * também não abre com saudação, prefixa uma saudação no idioma do hóspede.
 */
const GREETING_RE =
  /^\s*[¡!]?\s*(ol[aá]|oi\b|bom dia|boa tarde|boa noite|seja bem|sejam bem|bem[- ]vind[oa]s?|hello|hi\b|hey\b|good (morning|afternoon|evening)|welcome|hola|buen[oa]s|bienvenid[oa]s?)/i;

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

export function greetingFor(language: string | null | undefined, name: string | null, now = new Date()): string {
  const fn = firstName(name);
  const p = periodOfDay(now);
  if (language?.startsWith("en")) {
    const g = p === "m" ? "Good morning" : p === "t" ? "Good afternoon" : "Good evening";
    return fn ? `Hi, ${fn}! ${g}!` : `Hi! ${g}!`;
  }
  if (language?.startsWith("es")) {
    const g = p === "m" ? "¡Buenos días!" : p === "t" ? "¡Buenas tardes!" : "¡Buenas noches!";
    return fn ? `¡Hola, ${fn}! ${g}` : `¡Hola! ${g}`;
  }
  const g = p === "m" ? "Bom dia!" : p === "t" ? "Boa tarde!" : "Boa noite!";
  return fn ? `Olá, ${fn}! ${g}` : `Olá! ${g}`;
}

export function ensureGreeting(
  reply: string,
  history: Array<{ role: string; content: string }>,
  guestName: string | null,
  language: string | null | undefined,
  now = new Date(),
): string {
  if (!reply.trim() || hasGreeting(reply) || /\[SILENCIO\]/i.test(reply)) return reply;
  // Qualquer resposta anterior do assistente já abriu a conversa: não cumprimenta de novo.
  const alreadyAnswered = history.some((m) => m.role === "assistant" && m.content.trim());
  if (alreadyAnswered) return reply;
  return `${greetingFor(language, guestName, now)} ${reply}`;
}
