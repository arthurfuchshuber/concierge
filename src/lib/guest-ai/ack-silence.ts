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
  /\b(check ?out (feito|realizado|concluido|efetuado|ok|finalizado)|fizemos o check ?out|fiz o check ?out|ja (fizemos|fiz) o check ?out|(ja )?(saimos|sai|deixamos|desocupamos) (do|o|da|a) (apartamento|ap|apto|imovel|studio|estudio|casa|local|quarto)|ja (saimos|sai)\b|(deixei|deixamos) (as|a) chaves?|chaves? (no|na|dentro do|dentro da) (cofre|caixinha|lugar|apartamento|mesa|bancada)|checked out|we (have )?left)\b/;
const CHECKOUT_FILLER = [
  "ok", "pronto", "tudo certo", "deu tudo certo", "tudo ok", "ja", "sigma", "ola", "oi", "bom dia", "boa tarde", "boa noite", "conforme combinado",
  "conforme (as )?orientac\\w*", "e", "foi (tudo )?(otimo|otima|maravilhos[oa]|perfeito|excelente)",
  "(no|na|dentro do|dentro da|em cima da) (cofre|caixinha|mesa|bancada|lugar combinado|porta)",
];
const CHECKOUT_FILLER_RE = new RegExp(`\\b(${CHECKOUT_FILLER.join("|")})\\b`, "g");

/**
 * Aviso de saída concluída, só ou com despedida ("Check out feito", "check out feito, obrigado por tudo, deu tudo
 * certo", "já saímos do apartamento"). Os bastidores continuam lendo o fato (baixa do card); só não há tréplica.
 */
export function isCheckoutDoneNotice(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw || raw.includes("?") || raw.length > 220) return false;
  const n = normalizeAck(raw);
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

/** Janela em que um cumprimento repetido não ganha novo cumprimento nosso (anti-eco). */
export const GREETING_ECHO_WINDOW_MS = 30 * 60 * 1000;

/**
 * O turno atual do hóspede (mensagens seguidas dele no fim do histórico) deve ficar SEM resposta?
 * Mídia (foto/áudio) nunca é confirmação vazia.
 * - Sem pergunta nossa pendente: confirmação/cortesia ou afirmação sem pedido ⇒ silêncio.
 * - Nossa última mensagem foi a checagem do imóvel e o hóspede respondeu que está tudo bem (com ou sem elogio)
 *   ⇒ a checagem cumpriu o objetivo; silêncio (sem tréplica). Qualquer ressalva, pergunta ou pedido ⇒ modelo.
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
  if (!ours || !ours.text.includes("?")) return turn.every(closed);
  if (isAccommodationCheck(ours.text)) return turn.every((e) => closed(e) || isSatisfiedCheckReply(e.text));
  return false;
}
