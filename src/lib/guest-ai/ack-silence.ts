/**
 * SILÊNCIO GARANTIDO EM CONFIRMAÇÃO/CORTESIA SEM CONTEXTO (titular, 10/11/2026 — caso Karen: um "Sim" solto,
 * primeira mensagem da conversa, recebeu um texto institucional). Regra em CÓDIGO, acima do modelo:
 * se o turno do hóspede é só confirmação ou cortesia ("Sim", "Ok", "Obrigado", emoji…) e a nossa última mensagem
 * (IA, equipe ou sistema) não fez pergunta — ou não existe mensagem nossa —, a IA não responde.
 * Com pergunta nossa pendente ("Quer que eu envie o passo a passo?" → "Sim"), a conversa segue — exceto a
 * checagem do imóvel respondida com satisfação (caso Jenifer, 11/11/2026), que encerra o assunto. Puro.
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
 * Nossa mensagem foi a CHECAGEM do imóvel (acolhimento no check-in: "Vocês encontraram tudo certinho no
 * apartamento?")? Só uma pergunta na mensagem, e é a de checagem. Duas perguntas ⇒ não é checagem pura.
 */
const ACCOMMODATION_CHECK =
  /\b(encontra(ram|ste|r) tudo|tudo (certinho|certo|ok|em ordem|bem|conforme)|como (esperava|esperavam|imaginava|imaginavam)|ficou tudo|esta tudo|conseguiram se (acomodar|instalar)|se (acomodaram|instalaram) bem|gostaram (do|da) (apartamento|imovel|espaco|studio|casa|acomodacao))\b/;

export function isAccommodationCheck(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if ((raw.match(/\?/g) ?? []).length !== 1) return false;
  const question = raw.slice(0, raw.indexOf("?")).split(/[.!\n]/).pop() ?? "";
  return ACCOMMODATION_CHECK.test(normalizeAck(question));
}

const SATISFACTION =
  /\b(sim|encontramos|encontrei|tudo (certo|certinho|otimo|perfeito|bem|ok|em ordem|maravilhoso|lindo)|perfeito|otimo|otima|maravilh\w*|lind[oa]|bonit[oa]|incrivel|excelente|amamos|adoramos|gostamos|amei|adorei|gostei|confortavel|aconchegante|limp[oa]|limpinh[oa]|show|top)\b/;
const PROBLEM_OR_RESERVATION =
  /\b(nao|mas|porem|so que|entretanto|contudo|falt\w*|suj[oa]s?|quebrad\w*|estragad\w*|vazand\w*|vazamento|barulh\w*|cheiro|defeito|reclam\w*|duvida|frio|quente|calor|apagad\w*)\b/;

/**
 * Resposta de SATISFAÇÃO à checagem ("Encontramos sim. Um apartamento muito bonito.", caso Jenifer 11/11/2026):
 * afirma que está tudo bem, sem pergunta, pedido, horário, ressalva ou relato de problema. Na dúvida ⇒ não.
 */
export function isSatisfiedCheckReply(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 200) return false;
  const n = normalizeAck(raw);
  return SATISFACTION.test(n) && !PROBLEM_OR_RESERVATION.test(n) && !REQUEST_WORDS.test(n) && !TIME_MENTION.test(n);
}

// ─────────────── despedidas, check-out concluído e saudações repetidas (diretiva de 12/11/2026) ───────────────

/** Frases de agradecimento/despedida (texto normalizado). A mensagem precisa ter ao menos uma. */
const FAREWELL_CORE = [
  "muitissimo obrigad[oa]", "muito obrigad[oa]", "obrigad[oa]", "obrigadao", "obg", "agradec\\w*", "grat[oa]", "gratidao", "valeu",
  "ate mais", "ate logo", "ate breve", "ate a proxima", "ate a proxima vez", "ate outra hora", "tchau", "tchauzinho", "adeus",
  "abracos?", "abs", "beijos?", "bjs?", "boa viagem", "bom retorno", "boa volta", "volta tranquila", "deus abencoe", "fiquem com deus", "fique com deus",
  "thank you", "thanks", "bye", "goodbye", "see you", "gracias", "hasta luego", "adios",
];
/** Complementos neutros que podem acompanhar a despedida sem pedir nada. */
const FAREWELL_FILLER = [
  "ola", "oi", "oie", "bom dia", "boa tarde", "boa noite", "estimo que (esteja|estejam) bem", "espero que (esteja|estejam) bem",
  "por tudo", "pelo guia( digital)?", "pelas? (informac\\w*|orientac\\w*|instruc\\w*|dicas?)", "pela (hospedagem|estadia|estada|atencao|hospitalidade|recepcao|ajuda|paciencia|gentileza)",
  "pelo (atendimento|apoio|carinho|espaco|cuidado)", "de novo", "novamente", "mais uma vez", "e", "a", "o", "voces", "voce", "a todos",
  "deu tudo certo", "tudo certo", "foi (tudo )?(otimo|otima|maravilhos[oa]|perfeito|excelente|incrivel)", "amamos", "adoramos", "gostamos muito",
  "um (grande )?(abraco|beijo)", "sigma", "equipe", "pessoal", "querid[oa]s?", "tenham? (um|uma) (otimo|otima|bom|boa) (dia|tarde|noite|semana)",
  "sucesso", "por aqui", "muito", "demais", "ate", "tudo de bom", "tudo de bom pra voces",
];
const FAREWELL_CORE_RE = new RegExp(`\\b(${FAREWELL_CORE.join("|")})\\b`, "g");
const FAREWELL_FILLER_RE = new RegExp(`\\b(${FAREWELL_FILLER.join("|")})\\b`, "g");

/**
 * Despedida/agradecimento puro, sem pergunta nem pedido ("Muitíssimo obrigado pelo guia digital, até mais",
 * "Agradeço pelas informações. Abraço", "obrigado por tudo"). Na dúvida (sobra qualquer palavra) ⇒ não.
 */
export function isFarewell(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 220) return false;
  const n = normalizeAck(raw);
  if (!n || REQUEST_WORDS.test(n) || TIME_MENTION.test(n) || PROBLEM_OR_RESERVATION.test(n)) return false;
  if (!new RegExp(FAREWELL_CORE_RE.source).test(n)) return false;
  const rest = n.replace(FAREWELL_CORE_RE, " ").replace(FAREWELL_FILLER_RE, " ").replace(/\s+/g, " ").trim();
  return rest === "";
}

const CHECKOUT_DONE =
  /\b(check ?out (feito|realizado|concluido|efetuado|ok|finalizado)|fizemos o check ?out|fiz o check ?out|ja (fizemos|fiz) o check ?out|(ja )?(saimos|sai|deixamos|desocupamos) (do|o|da|a) (apartamento|ap|apto|imovel|studio|estudio|casa|local|quarto)|ja (saimos|sai)\b|(acabamos|acabei) de (sair|deixar o (apartamento|imovel|studio|estudio|casa|local))|(deixei|deixamos) (as|a) chaves?|chaves? (no|na|dentro do|dentro da) (cofre|caixinha|cadeado( cofre)?|lugar|apartamento|mesa|bancada)|checked out|we (have )?left)\b/;
const CHECKOUT_FILLER = [
  "ok", "pronto", "tudo certo", "deu tudo certo", "tudo ok", "ja", "sigma", "ola", "oi", "bom dia", "boa tarde", "boa noite", "conforme combinado",
  "conforme (as )?orientac\\w*", "e", "foi (tudo )?(otimo|otima|maravilhos[oa]|perfeito|excelente)",
  "(no|na|dentro do|dentro da|em cima da) (cofre|caixinha|cadeado( cofre)?|mesa|bancada|lugar combinado|porta)", "as", "os",
];
const CHECKOUT_FILLER_RE = new RegExp(`\\b(${CHECKOUT_FILLER.join("|")})\\b`, "g");

/**
 * Aviso de saída concluída, só ou com despedida ("Check out feito", "check out feito, obrigado por tudo, deu tudo
 * certo", "já saímos do apartamento"). Os bastidores continuam lendo o fato (baixa do card); só não há tréplica.
 */
export function isCheckoutDoneNotice(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 220) return false;
  // "as chaves ficaram no cofre" é devolução das chaves, não objeto esquecido (caso Rayssa, 17/11/2026)
  const n = normalizeAck(raw).replace(
    /\bchaves? (ficaram|ficou|estao|esta) (no|na|dentro do|dentro da) (cofre|caixinha|cadeado( cofre)?)\b/g,
    "chaves no $3",
  );
  if (!CHECKOUT_DONE.test(n) || TIME_MENTION.test(n) || PROBLEM_OR_RESERVATION.test(n)) return false;
  if (/\b(esqueci|esquecemos|ficou|ficaram|perdi|perdemos|onde|como|podem|pode|preciso|precisamos|gostaria|quero|queria)\b/.test(n)) return false;
  const rest = n
    .replace(new RegExp(CHECKOUT_DONE.source, "g"), " ")
    .replace(FAREWELL_CORE_RE, " ")
    .replace(FAREWELL_FILLER_RE, " ")
    .replace(CHECKOUT_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rest === "";
}

const GREETING = [
  "ola", "oi", "oie", "oii+", "oiee+", "opa", "e ai", "eai", "bom dia", "boa tarde", "boa noite", "tudo bem", "td bem", "tudo bom", "tudo certo",
  "como vai", "como vao", "como voce esta", "como esta", "como estao", "desculpa a demora", "desculpe a demora", "perdao pela demora",
  "perdoe a demora", "desculpa pela demora", "desculpe pela demora", "desculpa", "desculpe", "hello", "hi", "hey", "hola", "buenos dias",
  "buenas tardes", "buenas noches", "sigma", "e com voces", "e com voce", "e voce", "e voces", "por ai",
];
const GREETING_RE = new RegExp(`\\b(${GREETING.join("|")})\\b`, "g");

/** Só cumprimento ("Bom dia", "Oie", "Tudo bem?", "Desculpa a demora"), sem pergunta nova nem pedido. */
export function isPureGreeting(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.length > 80) return false;
  const n = normalizeAck(raw);
  if (!n || REQUEST_WORDS.test(n) || TIME_MENTION.test(n) || /\d/.test(n)) return false;
  if (!new RegExp(GREETING_RE.source).test(n)) return false;
  return n.replace(GREETING_RE, " ").replace(/\s+/g, " ").trim() === "";
}

// ─────────── confirmação do horário de saída pedido por nós (caso Carlos, 26/11/2026) ───────────

/** Nossa mensagem pediu o horário estimado/previsto de saída ("…qual é o seu horário estimado de saída?"). */
const CHECKOUT_TIME_QUESTION =
  /\b((horario|hora) (estimad[oa]|previst[oa]|aproximad[oa]|provavel)( de)? (saida|check ?out)|(horario|hora|previsao) (de|da) (saida|check ?out)|que horas? (voces? )?(vao|vai|pretende[m]?|deve[m]?|planeja[m]?) (sair|fazer o check ?out|deixar))\b/;

export function isCheckoutTimeQuestion(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw.includes("?")) return false;
  return CHECKOUT_TIME_QUESTION.test(normalizeAck(raw));
}

/** Horários citados num texto normalizado, em minutos desde 0h ("11h", "11 00", "10h30", "as 11", "11 horas", "meio dia"). */
export function mentionedTimes(n: string): number[] {
  const out: number[] = [];
  if (/\bmeio dia\b/.test(n)) out.push(12 * 60);
  const re = /\b(\d{1,2})(?:\s?(?:h|hs|hrs?|horas?)(?:\s?(\d{2}))?|\s(\d{2})\b)/g;
  for (const m of n.matchAll(re)) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? m[3] ?? 0);
    if (h <= 23 && min <= 59) out.push(h * 60 + min);
  }
  for (const m of n.matchAll(/\b(?:as|ate as|pelas|umas)\s(\d{1,2})\b(?!\s?(?:h|hs|hrs?|horas?|\d))/g)) {
    const h = Number(m[1]);
    if (h <= 23) out.push(h * 60);
  }
  return out;
}

const CHECKOUT_TIME_FILLER = [
  "vamos sair", "vou sair", "iremos sair", "irei sair", "devemos sair", "devo sair", "pretendemos sair", "pretendo sair", "planejamos sair",
  "vamos fazer o check ?out", "faremos o check ?out", "farei o check ?out", "vou fazer o check ?out", "saimos", "saio", "sairemos", "sairei",
  "vamos deixar o (apartamento|imovel|studio|estudio|casa|local)", "deixaremos o (apartamento|imovel|studio|estudio|casa|local)",
  "nossa saida (sera|vai ser)", "minha saida (sera|vai ser)", "a saida (sera|vai ser)", "saida", "previsao", "check ?out",
  "mesmo", "msm", "certinho", "no horario( padrao| combinado| normal)?", "horario( padrao| combinado| normal)?", "padrao", "normal",
  "combinado", "conforme combinado", "la pelas", "pelas", "por volta (das|de)", "umas", "as", "ate as", "no maximo", "antes", "mais ou menos",
  "aproximadamente", "da manha", "manha", "meio dia", "ok", "sim", "isso", "certo", "perfeito", "beleza", "blz", "entao", "acho que", "provavelmente",
  "e", "a", "o", "de", "da", "do", "h", "hs", "hrs?", "horas?",
];
const CHECKOUT_TIME_FILLER_RE = new RegExp(`\\b(${CHECKOUT_TIME_FILLER.join("|")})\\b`, "g");

/**
 * Só informa/confirma o horário de saída ("Vamos sair às 11h mesmo", "Saio às 10h", "Às 11h"), com cumprimento e
 * despedida opcionais. Pergunta, pedido, ressalva ou horário DEPOIS do limite que nós informamos ⇒ não (saída
 * depois do horário é pedido de late check-out e vai ao modelo/decisão). Sem limite conhecido ⇒ não.
 */
export function isCheckoutTimeReply(text: string | null | undefined, limitMinutes: number | null): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 160 || limitMinutes === null) return false;
  const n = normalizeAck(raw);
  if (!n || REQUEST_WORDS.test(n) || PROBLEM_OR_RESERVATION.test(n)) return false;
  const times = mentionedTimes(n);
  if (times.length === 0 || times.some((t) => t > limitMinutes)) return false;
  const rest = n
    .replace(/\b\d{1,2}(\s?(h|hs|hrs?|horas?)(\s?\d{2})?|\s\d{2})?\b/g, " ")
    .replace(GREETING_RE, " ")
    .replace(FAREWELL_CORE_RE, " ")
    .replace(FAREWELL_FILLER_RE, " ")
    .replace(CHECKOUT_TIME_FILLER_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  return rest === "";
}

/** Limite de saída citado na nossa mensagem ("deve acontecer até 11:00 horas"); o maior horário citado. */
export function checkoutLimitFrom(text: string | null | undefined): number | null {
  const times = mentionedTimes(normalizeAck(text ?? ""));
  return times.length ? Math.max(...times) : null;
}

/** Janela em que um cumprimento repetido não ganha novo cumprimento nosso (anti-eco). */
export const GREETING_ECHO_WINDOW_MS = 30 * 60 * 1000;

/**
 * O turno atual do hóspede (mensagens seguidas dele no fim do histórico) deve ficar SEM resposta?
 * Mídia (foto/áudio) nunca é confirmação vazia.
 * - Sem pergunta nossa pendente: confirmação/cortesia ou afirmação sem pedido ⇒ silêncio.
 * - Nossa última mensagem foi a checagem do imóvel e o hóspede respondeu que está tudo bem (com ou sem elogio)
 *   ⇒ a checagem cumpriu o objetivo; silêncio (sem tréplica). Qualquer ressalva, pergunta ou pedido ⇒ modelo.
 * - Nós pedimos o horário estimado de saída e o hóspede só informou um horário até o limite ⇒ silêncio.
 * - Outra pergunta nossa pendente ⇒ a conversa segue (modelo).
 */
export function shouldSilenceBareAck(entries: readonly HistoryEntry[]): boolean {
  let i = entries.length - 1;
  const turn: HistoryEntry[] = [];
  while (i >= 0 && entries[i]!.speaker === "guest") turn.unshift(entries[i--]!);
  if (turn.length === 0 || turn.some((e) => e.media != null)) return false;
  const ours = i >= 0 ? entries[i]! : null;
  const closed = (e: HistoryEntry) => isBareAcknowledgment(e.text) || isAffirmativeStatement(e.text);
  // despedida pura ou check-out concluído (com ou sem pergunta nossa pendente): sem tréplica (12/11/2026)
  const farewell = (e: HistoryEntry) => isFarewell(e.text) || isCheckoutDoneNotice(e.text);
  if (turn.some(farewell) && turn.every((e) => farewell(e) || closed(e))) return true;
  // ANTI-ECO: só cumprimento, e já falamos com o hóspede há pouco (até 30 min) ⇒ não cumprimenta de novo
  if (ours && turn.every((e) => isPureGreeting(e.text) || closed(e)) && turn.some((e) => isPureGreeting(e.text))) {
    const oursAt = Date.parse(ours.at ?? "");
    const lastAt = Date.parse(turn[turn.length - 1]!.at ?? "");
    if (Number.isFinite(oursAt) && Number.isFinite(lastAt) && lastAt - oursAt <= GREETING_ECHO_WINDOW_MS && lastAt >= oursAt) return true;
  }
  // nós pedimos o horário de saída e o hóspede só informou um horário dentro do limite: o card já é atualizado pelos
  // bastidores (extrator), sem tréplica no chat (caso Carlos, 26/11/2026)
  if (ours && isCheckoutTimeQuestion(ours.text)) {
    const limit = checkoutLimitFrom(ours.text);
    const timeReply = (e: HistoryEntry) => isCheckoutTimeReply(e.text, limit);
    if (turn.some(timeReply) && turn.every((e) => timeReply(e) || closed(e) || isPureGreeting(e.text) || isFarewell(e.text))) return true;
  }
  if (!ours || !ours.text.includes("?")) return turn.every(closed);
  if (isAccommodationCheck(ours.text)) return turn.every((e) => closed(e) || isSatisfiedCheckReply(e.text));
  return false;
}

/**
 * Já cumprimentamos há pouco? (casos Luiz Eduardo, 19/11/2026: "Olá, Luiz, bom dia! Tudo bem por aí?" e, 3 min depois,
 * "Olá, Luiz! Seja bem-vindo.") Verdadeiro se houve fala nossa (IA ou equipe) até `GREETING_ECHO_WINDOW_MS` antes da
 * mensagem atual do hóspede.
 */
export function greetedRecently(entries: readonly HistoryEntry[]): boolean {
  let i = entries.length - 1;
  while (i >= 0 && entries[i]!.speaker === "guest") i--;
  if (i < 0 || i === entries.length - 1) return false;
  const ours = entries[i]!;
  if (ours.speaker !== "legacy_ai" && ours.speaker !== "team") return false;
  const oursAt = Date.parse(ours.at ?? "");
  const lastAt = Date.parse(entries[entries.length - 1]!.at ?? "");
  return Number.isFinite(oursAt) && Number.isFinite(lastAt) && lastAt >= oursAt && lastAt - oursAt <= GREETING_ECHO_WINDOW_MS;
}

const OPENING_GREETING = /^(ol[aá]|oi|bom dia|boa tarde|boa noite)(?=[\s,.!?]|$)[^.!?\n]*[.!?]*\s*/i;
const OPENING_WELCOME = /^seja[m]? (muito )?bem[- ]vind[oa]s?(?=[\s,.!?]|$)[^.!?\n]*[.!?]*\s*/i;

/** Tira o cumprimento de abertura de uma resposta (só a abertura; o resto fica intacto). Sem resto ⇒ texto original. */
export function stripOpeningGreeting(text: string): string {
  let t = text.trimStart();
  for (let k = 0; k < 3; k++) {
    const m = t.match(OPENING_GREETING) ?? t.match(OPENING_WELCOME);
    if (!m) break;
    t = t.slice(m[0].length).trimStart();
  }
  if (!t) return text;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
