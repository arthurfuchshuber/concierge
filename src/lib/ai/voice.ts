/**
 * VOZ DA IA (17/10/2026, decisões do anfitrião).
 *
 * Regras, todas determinísticas (sem chamada de modelo):
 *  - Espelhar formalidade e tamanho do hóspede; nunca gíria.
 *  - Emoji e risada SÓ se o hóspede usa; discretos, sem repetir e sem duplicar:
 *      · no máximo 1 emoji por mensagem;
 *      · o mesmo emoji/risada não aparece nas 2 últimas falas da IA;
 *      · nenhum emoji em reclamação, problema no imóvel ou sentimento negativo;
 *      · risada só como resposta a risada/piada do hóspede.
 *  - Detecção de repetição ("lint de tom"): mesma abertura, mesmo fecho,
 *    sobreposição de 4-gramas e muleta de abertura ("Perfeito", "Ótimo"…).
 *    A detecção é pura; quem decide reescrever é o chamador.
 */

export type Turn = { role: string; content: string };

const EMOJI_RE = /\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*/gu;
/** kkk, rsrs, haha, hehe, hihi, 😂/🤣 contam como risada. */
const LAUGH_RE = /\b(?:k{3,}|(?:rs){2,}|r{1}s{1,2}\b|(?:ha){2,}h?|(?:he){2,}h?|(?:hi){2,}h?|lol|lmao|jaja+)\b|[😂🤣😆😹]/giu;

export function emojisOf(text: string): string[] {
  return text.match(EMOJI_RE) ?? [];
}

export function hasLaughter(text: string): boolean {
  LAUGH_RE.lastIndex = 0;
  return LAUGH_RE.test(text);
}

const last = <T,>(a: T[], n: number) => a.slice(Math.max(0, a.length - n));

export type GuestVoice = {
  usesEmoji: boolean;
  laughedNow: boolean;
  formal: boolean;
  /** palavras da última fala do hóspede (referência de tamanho). */
  words: number;
};

const FORMAL_RE = /\b(senhor|senhora|prezad[oa]s?|gostaria|poderia|poderiam|por gentileza|atenciosamente|cordialmente|agradeço|agradeco)\b/i;

/** Lê o registro do hóspede nas últimas falas dele. */
export function readGuestVoice(history: Turn[], currentMessage: string): GuestVoice {
  const guest = [...history.filter((m) => m.role === "user").map((m) => m.content), currentMessage];
  const recent = last(guest, 5);
  return {
    usesEmoji: recent.some((t) => emojisOf(t).length > 0),
    laughedNow: hasLaughter(currentMessage),
    formal: recent.some((t) => FORMAL_RE.test(t)),
    words: currentMessage.trim().split(/\s+/).filter(Boolean).length,
  };
}

/** Texto curto de orientação injetado no contexto do agente (o modelo escreve; o filtro garante). */
export function voiceGuidance(v: GuestVoice, negative: boolean): string {
  const lines = [
    v.formal
      ? "- O hóspede é formal: trate por 'você' com cortesia, frases completas, sem informalidade."
      : "- Tom natural e acolhedor, sem gíria e sem excesso de formalidade.",
    v.words <= 6
      ? "- A mensagem dele é curta: responda curto e direto (1 a 3 frases)."
      : v.words >= 40
        ? "- A mensagem dele é longa e detalhada: pode responder com mais detalhe, mas sem encher."
        : "- Mantenha o tamanho próximo ao da mensagem dele.",
    negative
      ? "- Há desconforto ou problema: nada de emoji, nada de risada, nada de entusiasmo; empatia sóbria e objetiva."
      : v.usesEmoji
        ? "- Ele usa emoji: no máximo UM emoji, só se couber, e nunca o mesmo da sua última fala."
        : "- Ele não usa emoji: não use emoji.",
    v.laughedNow
      ? "- Ele riu: pode devolver uma risada leve (uma só, ex.: 'haha'), sem forçar."
      : "- Não use risadas (kkk/haha) se ele não riu agora.",
    "- Nunca repita a abertura nem o fecho das suas últimas falas; varie o vocabulário.",
  ];
  return lines.join("\n");
}

/** Remove emojis/risadas que violam as regras. Nunca mexe em números, links ou nomes. */
export function applyVoiceRules(params: {
  reply: string;
  history: Turn[];
  voice: GuestVoice;
  negative: boolean;
  /** problema no imóvel / incidente: proíbe emoji e risada. */
  problem?: boolean;
}): string {
  let text = params.reply;
  const recentAi = last(params.history.filter((m) => m.role === "assistant").map((m) => m.content), 2);
  const recentEmojis = new Set(recentAi.flatMap(emojisOf));
  const recentLaugh = recentAi.some(hasLaughter);
  const noFun = params.negative || params.problem === true;

  // Emojis
  let kept = 0;
  text = text.replace(EMOJI_RE, (e) => {
    if (noFun || !params.voice.usesEmoji || recentEmojis.has(e) || kept >= 1) return "";
    kept += 1;
    return e;
  });

  // Risadas
  let laughKept = 0;
  LAUGH_RE.lastIndex = 0;
  text = text.replace(LAUGH_RE, (l) => {
    if (noFun || !params.voice.laughedNow || recentLaugh || laughKept >= 1) return "";
    laughKept += 1;
    return l;
  });

  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ───────────────────────── Lint de tom (repetição) ─────────────────────────

const CRUTCH_OPENERS = /^\s*(perfeito|[óo]timo|claro|certo|entendi|com certeza|sem problemas?)\b/i;

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function grams(w: string[], n = 4): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i += 1) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export type ToneIssue = "same_opener" | "same_closing" | "overlap" | "crutch_opener" | "question_every_time";

/** Detecta repetição em relação às últimas falas da IA. Pura e barata. */
export function toneLint(reply: string, history: Turn[]): ToneIssue[] {
  const prev = last(history.filter((m) => m.role === "assistant" && m.content.trim()), 3).map((m) => m.content);
  if (!prev.length || !reply.trim()) return [];
  const issues: ToneIssue[] = [];
  const first = (s: string) => words(s).slice(0, 2).join(" ");
  const lastSentence = (s: string) => {
    const parts = s.split(/(?<=[.!?])\s+/).filter(Boolean);
    return words(parts[parts.length - 1] ?? "").join(" ");
  };
  if (first(reply) && prev.some((p) => first(p) === first(reply))) issues.push("same_opener");
  const closing = lastSentence(reply);
  if (closing.split(" ").length >= 3 && prev.some((p) => lastSentence(p) === closing)) issues.push("same_closing");
  const g = grams(words(reply));
  if (g.size) {
    for (const p of prev) {
      const pg = grams(words(p));
      let hit = 0;
      for (const x of g) if (pg.has(x)) hit += 1;
      if (hit / g.size >= 0.3) {
        issues.push("overlap");
        break;
      }
    }
  }
  if (CRUTCH_OPENERS.test(reply) && prev.some((p) => CRUTCH_OPENERS.test(p))) issues.push("crutch_opener");
  if (/\?\s*$/.test(reply.trim()) && prev.every((p) => /\?\s*$/.test(p.trim()))) issues.push("question_every_time");
  return issues;
}

/** Valores que a reescrita NÃO pode alterar (números, horários, links, nomes próprios simples). */
export function protectedTokens(text: string): string[] {
  const nums = text.match(/\d[\d:.,/h-]*/g) ?? [];
  const links = text.match(/https?:\/\/\S+|\/g\/\S+/g) ?? [];
  const names = (text.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\p{L}]{2,}\b/gu) ?? []).slice(1);
  return [...new Set([...nums, ...links, ...names])];
}

/** A reescrita só vale se preservar todos os valores protegidos. */
export function rewritePreserves(original: string, rewritten: string): boolean {
  return protectedTokens(original).every((t) => rewritten.includes(t));
}

// ───────────────────────── Métricas de humanidade ─────────────────────────

export type Humanity = {
  /** palavras da resposta e da mensagem do hóspede. */
  words: number;
  guestWords: number;
  /** resposta ÷ mensagem (espelhamento de tamanho; ~0.5–3 é natural). */
  lengthRatio: number;
  emojis: number;
  laughter: boolean;
  /** repetições detectadas em relação às últimas falas da IA. */
  toneIssues: ToneIssue[];
  /** reescrita de tom aplicada nesta resposta. */
  rewritten: boolean;
  /** reconhecimento caloroso com retorno da equipe enviado. */
  acknowledged: boolean;
  /** hóspede usa emoji/forma e a IA seguiu a regra. */
  emojiRuleOk: boolean;
  /** resposta enviada em silêncio. */
  silent: boolean;
};

export function humanityMetrics(p: {
  reply: string;
  guestMessage: string;
  history: Turn[];
  voice: GuestVoice;
  negative: boolean;
  rewritten: boolean;
  acknowledged: boolean;
}): Humanity {
  const w = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  const words = w(p.reply);
  const guestWords = Math.max(1, w(p.guestMessage));
  const emojis = emojisOf(p.reply).length;
  return {
    words,
    guestWords,
    lengthRatio: Number((words / guestWords).toFixed(2)),
    emojis,
    laughter: hasLaughter(p.reply),
    toneIssues: toneLint(p.reply, p.history),
    rewritten: p.rewritten,
    acknowledged: p.acknowledged,
    emojiRuleOk: emojis === 0 || (p.voice.usesEmoji && !p.negative && emojis <= 1),
    silent: !p.reply.trim() || p.reply.includes("[SILENCIO]"),
  };
}

export type HumanityReport = {
  replies: number;
  /** % de respostas com alguma repetição de abertura/fecho/trecho. */
  repetitionRate: number;
  /** % em que a IA usou emoji sem o hóspede usar (ou em problema). */
  emojiViolationRate: number;
  /** % de respostas reescritas por repetição. */
  rewriteRate: number;
  /** tamanho médio resposta ÷ mensagem. */
  avgLengthRatio: number;
  /** % de respostas com reconhecimento caloroso. */
  acknowledgementRate: number;
  /** abertura mais repetida (fingerprint de 2 palavras) — sem texto do hóspede. */
  topIssues: Array<{ issue: ToneIssue; count: number }>;
};

export function summarizeHumanity(rows: Humanity[]): HumanityReport {
  const spoken = rows.filter((r) => !r.silent);
  const n = spoken.length || 1;
  const pct = (x: number) => Number(((x / n) * 100).toFixed(1));
  const issueCount = new Map<ToneIssue, number>();
  for (const r of spoken) for (const i of r.toneIssues) issueCount.set(i, (issueCount.get(i) ?? 0) + 1);
  return {
    replies: spoken.length,
    repetitionRate: pct(spoken.filter((r) => r.toneIssues.length > 0).length),
    emojiViolationRate: pct(spoken.filter((r) => !r.emojiRuleOk).length),
    rewriteRate: pct(spoken.filter((r) => r.rewritten).length),
    avgLengthRatio: Number((spoken.reduce((a, r) => a + r.lengthRatio, 0) / n).toFixed(2)),
    acknowledgementRate: pct(spoken.filter((r) => r.acknowledged).length),
    topIssues: [...issueCount.entries()].map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count),
  };
}
