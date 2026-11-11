/**
 * GATE G2 · segunda barreira ANTIFALSO-POSITIVO, independente do modelo (pura).
 *
 * O modelo declara o sinal e cita o trecho literal. Aqui o sistema confere, sem interpretar intenção:
 *  1. o trecho existe na mensagem do hóspede (comparação normalizada: caixa, acentos e espaços);
 *  2. a FRASE que contém o trecho não traz negação, futuro/plano, pergunta, problema, condição, saída
 *     temporária ou contexto que não seja o imóvel (PT, EN e ES).
 * Na dúvida, recusa: um falso negativo custa um clique da equipe; um falso positivo libera limpeza
 * com hóspede dentro do imóvel. Não gera frases nem altera texto.
 */
import type { OpsRefusalCode } from "./contracts";

/** Minúsculas, sem acentos, apóstrofos unificados e espaços colapsados. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Frase (do texto normalizado) que contém o trecho; `null` se o trecho não estiver no texto. */
export function sentenceContaining(text: string, quote: string): string | null {
  const t = normalizeText(text);
  const q = normalizeText(quote);
  if (q.length < 3) return null;
  const at = t.indexOf(q);
  if (at < 0) return null;
  const isBoundary = (c: string) => c === "." || c === "!" || c === "?" || c === "\n" || c === ";";
  let start = at;
  while (start > 0 && !isBoundary(t[start - 1]!)) start -= 1;
  let end = at + q.length;
  while (end < t.length && !isBoundary(t[end]!)) end += 1;
  // o ponto de interrogação que fecha a frase faz parte dela
  if (end < t.length && t[end] === "?") end += 1;
  return t.slice(start, end).trim();
}

const W = (words: string[]) => new RegExp(`(?:^|[^a-z0-9'])(?:${words.join("|")})(?=$|[^a-z0-9'])`);

const NEGATION = W([
  "nao",
  "ainda",
  "nem",
  "nunca",
  "jamais",
  "not",
  "never",
  "yet",
  "[a-z]+n't",
  "no (?:hemos|pudimos|podemos|logramos|estamos|salimos|entramos|hemos podido)",
  "todavia",
  "aun",
  "tampoco",
]);
const FUTURE = W([
  "vamos",
  "vou",
  "vai",
  "vao",
  "iremos",
  "irei",
  "pretendemos",
  "pretendo",
  "devemos",
  "quando",
  "assim que",
  "depois que",
  "logo mais",
  "mais tarde",
  "em breve",
  "daqui a pouco",
  "amanha",
  "will",
  "[a-z]+'ll",
  "going to",
  "gonna",
  "planning",
  "plan to",
  "later",
  "soon",
  "tomorrow",
  "when we",
  "once we",
  "voy",
  "vamos a",
  "manana",
  "luego",
  "cuando",
]);
const QUESTION_WORDS = W([
  "posso",
  "podemos",
  "pode",
  "consigo",
  "can we",
  "can i",
  "could we",
  "may we",
  "puedo",
  "se puede",
]);
const PROBLEM = W([
  "problema",
  "problemas",
  "travou",
  "travad[ao]",
  "erro",
  "quebr[a-z]*",
  "trancad[ao]s?",
  "presos?",
  "ajuda",
  "socorro",
  "problem",
  "issue",
  "broken",
  "damaged?",
  "leak[a-z]*",
  "stuck",
  "locked out",
  "cannot",
  "unable",
  "doesn't work",
  "isn't working",
  "not working",
  "help",
  "no funciona",
  "no abre",
  "no puedo",
  "no podemos",
  "ayuda",
]);
const CONDITIONAL = W(["se", "caso", "if", "unless", "en caso"]);
const TEMPORARY_LEAVE = W([
  "jantar",
  "almocar",
  "almoco",
  "cafe",
  "passear",
  "passeio",
  "praia",
  "mercado",
  "supermercado",
  "compras",
  "dar uma volta",
  "rapidinho",
  "um pouco",
  "volto",
  "voltamos",
  "voltar",
  "ja volto",
  "dinner",
  "lunch",
  "breakfast",
  "beach",
  "shopping",
  "for a walk",
  "be back",
  "come back",
  "grocer[a-z]*",
  "cenar",
  "almorzar",
  "playa",
  "volvemos",
  "paseo",
]);
const NOT_PROPERTY = W([
  "airbnb",
  "app",
  "aplicativo",
  "site",
  "grupo",
  "link",
  "guia",
  "portal",
  "wifi",
  "wi-fi",
  "rede",
  "internet",
  "conta",
  "sistema",
  "chat",
  "website",
  "account",
  "network",
  "aplicacion",
  "pagina",
]);
const UNCERTAIN = W([
  "talvez",
  "nao sei",
  "nao sabemos",
  "depende",
  "ainda nao sei",
  "sem certeza",
  "maybe",
  "perhaps",
  "not sure",
  "don't know",
  "depends",
  "quizas",
  "tal vez",
  "no se",
  "no sabemos",
]);
const ETA_NEGATION = W([
  "nao vamos",
  "nao vou",
  "nao conseguiremos",
  "won't",
  "will not",
  "can't",
  "no vamos",
  "no voy",
]);

/**
 * Relato, como fato consumado, de que o acesso ao imóvel destravou ("agora consegui", "abriu", "deu certo",
 * "já peguei a chave"). Só vale como entrada com suporte de acesso antes (`accessSupportContext`) e no dia do
 * check-in (`policy.ts`).
 */
const ACCESS_RESOLVED = W([
  "consegui",
  "conseguimos",
  "abriu",
  "abrimos",
  "abri",
  "deu certo",
  "funcionou",
  "destravou",
  "liberou",
  "ja peguei a chave",
  "ja peguei as chaves",
  "peguei a chave",
  "peguei as chaves",
  "it worked",
  "got it open",
  "got in",
  "it opened",
  "ya pude",
  "ya abri",
  "se abrio",
  "ya tengo la llave",
]);
export function accessResolvedMarker(sentence: string): boolean {
  return ACCESS_RESOLVED.test(normalizeText(sentence));
}

/** Assuntos de acesso (senha, cadeado, cofre, chave, porta…): base do "suporte de acesso" anterior. */
const ACCESS_TOPIC = W([
  "senha",
  "codigo",
  "pin",
  "cofre",
  "cadeado",
  "chave",
  "chaves",
  "fechadura",
  "tranca",
  "porta",
  "portao",
  "lockbox",
  "teclado",
  "acesso",
  "password",
  "code",
  "key",
  "door",
  "gate",
  "lock",
  "llave",
  "puerta",
  "contrasena",
]);
const ACCESS_TROUBLE = W([
  "errad[ao]s?",
  "nao funcion[a-z]*",
  "nao abr[a-z]*",
  "nao consig[a-z]*",
  "nao deu",
  "nao entra[a-z]*",
  "travou",
  "problema",
  "invalid[ao]",
  "incorret[ao]",
  "wrong",
  "not working",
  "doesn't work",
  "didn't work",
  "no funciona",
  "no abre",
]);
export interface AccessContextEntry {
  speaker: string;
  text: string;
  at?: string;
}
/**
 * Houve suporte de acesso antes da mensagem de evidência? Nas 12 mensagens anteriores (até 6 h antes, quando há
 * horário): o HÓSPEDE relatou dificuldade (senha errada, não funcionou, não abre…) E o assunto é acesso (senha,
 * cadeado, cofre, chave, porta…) no que ele ou a equipe disseram. Saudação da equipe ou da IA com o código, sem
 * dificuldade relatada, não é suporte.
 */
export function accessSupportContext(
  before: readonly AccessContextEntry[],
  evidenceAt: string | null,
): boolean {
  const ref = evidenceAt ? Date.parse(evidenceAt) : NaN;
  let trouble = false;
  let topic = false;
  for (const e of before.slice(-12)) {
    if (e.speaker !== "guest" && e.speaker !== "team") continue;
    if (Number.isFinite(ref) && e.at) {
      const t = Date.parse(e.at);
      if (Number.isFinite(t) && ref - t > 6 * 3_600_000) continue;
    }
    const s = normalizeText(e.text);
    if (ACCESS_TOPIC.test(s)) topic = true;
    if (e.speaker === "guest" && ACCESS_TROUBLE.test(s)) trouble = true;
  }
  return trouble && topic;
}

export type LexicalKind = "done" | "checkin_done" | "checkout_done" | "eta";

/** Barreira léxica na frase do trecho. `null` = passou. */
export function lexicalGuard(sentence: string, kind: LexicalKind): OpsRefusalCode | null {
  const s = normalizeText(sentence);
  if (s.includes("?") || QUESTION_WORDS.test(s)) return "lexical_question";
  if (kind === "eta") {
    if (UNCERTAIN.test(s)) return "lexical_uncertain";
    if (ETA_NEGATION.test(s)) return "lexical_negation";
    if (CONDITIONAL.test(s)) return "lexical_conditional";
    return null;
  }
  // acesso destravado como fato consumado: a palavra de problema do contexto ("senha errada") não bloqueia a
  // frase que relata a solução; negação, futuro, dúvida e contexto fora do imóvel continuam bloqueando
  if (kind === "checkin_done" && ACCESS_RESOLVED.test(s)) {
    if (NEGATION.test(s)) return "lexical_negation";
    if (FUTURE.test(s)) return "lexical_future";
    if (UNCERTAIN.test(s)) return "lexical_uncertain";
    if (NOT_PROPERTY.test(s)) return "lexical_not_property_access";
    return null;
  }
  if (PROBLEM.test(s)) return "lexical_problem";
  if (NEGATION.test(s)) return "lexical_negation";
  if (FUTURE.test(s)) return "lexical_future";
  if (CONDITIONAL.test(s)) return "lexical_conditional";
  if (UNCERTAIN.test(s)) return "lexical_uncertain";
  if (kind === "checkout_done" && TEMPORARY_LEAVE.test(s)) return "lexical_temporary_leave";
  if (kind === "checkin_done" && NOT_PROPERTY.test(s)) return "lexical_not_property_access";
  return null;
}

/** A hora proposta aparece no trecho (24 h ou 12 h)? Ex.: 16:30 ⇒ "16", "16h30", "4:30 pm". */
export function timeAppearsInQuote(quote: string, time: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m) return false;
  const h = Number(m[1]);
  const q = normalizeText(quote);
  const hours = new Set([String(h), String(h).padStart(2, "0")]);
  if (h > 12) hours.add(String(h - 12));
  if (h === 0) hours.add("12");
  for (const hh of hours) {
    if (new RegExp(`(?:^|[^0-9])${hh}(?:$|[^0-9])`).test(q)) return true;
  }
  return false;
}

/**
 * Fato CONSUMADO de saída (diretriz 3, saída antecipada): exige marca explícita de passado no trecho.
 * Sem ela, a saída antes da data final não é aceita (certeza absoluta).
 */
const PAST_DEPARTURE = W([
  "ja sai",
  "ja saimos",
  "acabei de sair",
  "acabamos de sair",
  "ja entreguei",
  "ja entregamos",
  "deixei as chaves",
  "deixamos as chaves",
  "deixei a chave",
  "deixamos a chave",
  "already left",
  "we left",
  "i left",
  "just left",
  "checked out",
  "ya sali",
  "ya salimos",
  "ya entregue",
  "ya entregamos",
  "deje las llaves",
  "dejamos las llaves",
  "deje la llave",
  "dejamos la llave",
]);
export function pastDepartureMarker(sentence: string): boolean {
  return PAST_DEPARTURE.test(normalizeText(sentence));
}
