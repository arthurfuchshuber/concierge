/**
 * F2-B · B2.2 — FREE TEXT GUARD real ("secret-scrub" estrutural), puro, local e determinístico.
 *
 * Objetivo: nenhum segredo digitado em texto livre (mensagens, transcrições, dossiês, manuais…)
 * chega ao prompt. Sem serviço externo, sem modelo de IA e SEM ler colunas protegidas de senha
 * (definição vinculante da B1): a detecção é por ESTRUTURA e CONTEXTO, nunca por comparação com o
 * valor real.
 *
 * Camadas (nenhuma é "um regex genérico"):
 *  0. Normalização para varredura: NFKC (dígitos de largura total, compatibilidade) e remoção de
 *     caracteres invisíveis/de controle de formatação (zero-width, bidi, soft hyphen…), que poderiam
 *     esconder um código ("1\u200B2\u200B3\u200B4"). O texto devolvido é o normalizado.
 *  1. Estruturais (sem contexto): bloco de chave privada (bloqueia o texto inteiro), JWT, chaves de
 *     API com prefixo conhecido (OpenAI, Stripe, GitHub, Slack, AWS, Google), "Bearer <token>",
 *     rótulo de API/token com atribuição, URL com usuário:senha ou parâmetro de credencial, e
 *     sequência longa de alta entropia (fora de URLs; UUIDs canônicos ficam).
 *  2. Contextuais (domínio de hospedagem, PT/EN/ES): rótulo de senha ou de código/dispositivo
 *     (senha, password, código, PIN, cofre, cadeado, fechadura, portão, porta, teclado, lockbox…)
 *     seguido, na mesma frase, do valor — com ou sem marcador de atribuição (":", "=", "é", "is").
 *     Valor com Markdown/aspas/crase tem o envoltório preservado. Dígitos espaçados ("1 2 3 4")
 *     contam como um valor. Exclusões explícitas: código de reserva/confirmação/rastreio/postal,
 *     horários, datas, dinheiro, percentuais e números de apartamento/andar/rua.
 *  3. Verbo de ação: "digite/insira/use/coloque/type/enter <valor>" quando há palavra de acesso na
 *     mesma frase.
 *  4. Reverso (incerto ⇒ `ambiguous`): "<valor> é a senha", "<valor> no portão/no cofre…".
 *  5. Valor dividido entre mensagens (incerto ⇒ `ambiguous`): mensagem que só traz um valor de
 *     código, logo após uma mensagem que termina num rótulo sem valor ("a senha é") ou que fala de
 *     acesso — o composer passa a mensagem anterior em `hint.previous`.
 *
 * Resultado: `safe` (nada encontrado) | `sanitized` (segredo removido com certeza) |
 * `ambiguous` (removido por precaução) | `blocked` (texto inteiro retido: chave privada ou excesso
 * de segredos). O conteúdo legítimo ao redor é preservado. O texto original NUNCA é devolvido em
 * caso de falha; quem chama recusa compor (ver `composer.ts`).
 *
 * Idempotente: os marcadores são protegidos antes da varredura; reaplicar não muda nada.
 * Métricas: só categoria e detector (contagens) — nunca valor, trecho ou posição.
 *
 * Limitações conhecidas (documentadas no relatório): números por extenso, leetspeak, valor
 * dividido em mais de duas mensagens ou muito distante do rótulo, senha sem dígito sem marcador de
 * atribuição/envoltório, e segredos sem nenhum indício estrutural ou contextual.
 */

export const SECRET_SCRUB_ID = "secret-scrub";
export const SECRET_SCRUB_VERSION = "2026-11-07.1";
export const SECRET_MARKER = "[segredo removido]";
export const BLOCK_MARKER = "[conteúdo retido por segurança]";

export const SCRUB_STATUSES = ["safe", "sanitized", "ambiguous", "blocked"] as const;
export type ScrubStatus = (typeof SCRUB_STATUSES)[number];

export const SECRET_CATEGORIES = [
  "password",
  "wifi_secret",
  "access_code",
  "api_key",
  "token",
  "url_credential",
  "private_key",
  /** Caractere invisível suspeito removido (bidi, espaço de largura zero fora de emoji…): não é segredo. */
  "hidden_character",
] as const;
export type SecretCategory = (typeof SECRET_CATEGORIES)[number];

export type SecretDetector = "structural" | "label_value" | "action_verb" | "reverse" | "split_message" | "entropy" | "url" | "normalization";

export interface ScrubFinding {
  category: SecretCategory;
  detector: SecretDetector;
}

export interface ScrubResult {
  status: ScrubStatus;
  /** Texto pronto para uso (normalizado e sem segredos) — ou `BLOCK_MARKER`. */
  text: string;
  /** Só categoria e detector. Nunca valor, trecho ou posição. */
  findings: ScrubFinding[];
}

export interface ScrubHint {
  /** Mensagem imediatamente anterior da conversa (texto original), para o caso de valor dividido. */
  previous?: string | null;
}

/** Mais segredos que isto num único texto = provável "despejo" de credenciais ⇒ bloqueia tudo. */
export const MAX_FINDINGS_BEFORE_BLOCK = 12;

// ───────────────────────────── 0. Normalização ─────────────────────────────

/**
 * Invisíveis removidos (controles bidi, espaços de largura zero, preenchimentos Hangul, seletores de variação
 * FE00–FE0D…). NÃO entram (07/11/2026, emojis reais quebravam a composição com `guard_failed`):
 *  - U+FE0E / U+FE0F (seletores de apresentação texto/emoji: ☀️, 🗓️, ❤️);
 *  - U+200D (ZWJ) quando liga partes de um emoji composto (👩‍🍳, famílias, 🏳️‍🌈) — fora de emoji, sai;
 *  - modificadores de tom de pele (U+1F3FB–1F3FF), indicadores regionais (bandeiras), tags de bandeira
 *    (U+E0020–E007F) e o keycap U+20E3, que nem são invisíveis aqui.
 */
const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0]/g;
/** ZWJ que NÃO está entre duas partes de emoji (emoji opcionalmente com FE0F ou tom de pele, depois emoji). */
const STRAY_ZWJ = /(?<![\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F])\u200D|\u200D(?!\p{Extended_Pictographic})/gu;
/** Sentinelas (área de uso privado) que protegem os marcadores durante a varredura. */
const S_SECRET = "\uE000";
const S_BLOCK = "\uE001";

/**
 * Normalização LEVE do texto devolvido: NFC (canônica, não muda o significado) e remoção de
 * invisíveis. A forma de compatibilidade (NFKC: "１２３４" → "1234") é usada só na CÓPIA de varredura
 * (`detectionView`), com mapeamento de posições: o texto devolvido mantém "12º", ligaduras etc.
 */
export function normalizeForScan(text: string): string {
  return text.normalize("NFC").replace(INVISIBLE, "").replace(STRAY_ZWJ, "");
}

/** Cópia de varredura em NFKC, caractere a caractere, com o mapa de volta para o texto leve. */
function detectionView(light: string): { det: string; from: number[]; to: number[] } {
  let det = "";
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  for (const ch of light) {
    const k = ch === "\uE000" || ch === "\uE001" ? ch : ch.normalize("NFKC");
    for (let j = 0; j < k.length; j++) {
      from.push(i);
      to.push(i + ch.length);
    }
    det += k;
    i += ch.length;
  }
  return { det, from, to };
}

// ───────────────────────────── utilidades ─────────────────────────────

type Certainty = "certain" | "uncertain";
interface Span {
  start: number;
  end: number;
  category: SecretCategory;
  detector: SecretDetector;
  certainty: Certainty;
}

const WRAP_OPEN = "*_`\"'“”‘’«»([{<";
const WRAP_CLOSE = "*_`\"'“”‘’«»)]}>.,;:!?";

/** Remove envoltórios (Markdown, aspas, crase, parênteses, pontuação final) e devolve o miolo e o deslocamento. */
function core(token: string): { text: string; offset: number } {
  let a = 0;
  let b = token.length;
  while (a < b && WRAP_OPEN.includes(token[a]!)) a++;
  while (b > a && WRAP_CLOSE.includes(token[b - 1]!)) b--;
  return { text: token.slice(a, b), offset: a };
}

const hasDigit = (s: string) => /\d/.test(s);
const TIME = /^\d{1,2}(?:[:h]\d{2})?h?(?:min)?$/i;
const DATE = /^(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])(?:[/.-](?:\d{2}|\d{4}))?$/;
const MONEY_OR_PCT = /^(?:R?\$|€|US\$)?\d+(?:[.,]\d+)*(?:%|,\d{2})?$/;
const ORDINAL = /^\d+(?:º|ª|°|o|a|st|nd|rd|th)$/i;

/** Valor com "cara" de código/segredo (não horário, data, dinheiro, percentual nem ordinal). */
function codeLike(c: string, minLen = 3): boolean {
  if (c.length < minLen || c.length > 64) return false;
  if (!hasDigit(c)) return false;
  if (TIME.test(c) || DATE.test(c) || ORDINAL.test(c)) return false;
  // dinheiro e percentual: só quando tem separador decimal/%/símbolo (um "7777" puro continua candidato)
  if (MONEY_OR_PCT.test(c) && /[$€%]|,\d{2}$/.test(c)) return false;
  return /^[\p{L}\p{N}#*@$!%&+=._\-/]+$/u.test(c);
}

/** Palavra (só letras) que pode ser senha quando há atribuição explícita ou envoltório. */
function wordSecret(c: string): boolean {
  return c.length >= 4 && c.length <= 64 && /^[\p{L}\p{N}#*@$!%&+=._\-]+$/u.test(c) && !STOPWORDS.has(c.toLowerCase());
}

const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "do", "da", "dos", "das", "no", "na", "em", "e", "é", "eh", "para", "pra", "com", "sem", "que", "se",
  "the", "is", "an", "of", "to", "for", "and", "on", "at", "in", "it", "this", "that",
  "mesma", "mesmo", "igual", "abaixo", "acima", "seguinte", "enviada", "enviado", "informada", "informado", "anterior", "nova", "novo",
  "temporária", "temporaria", "temporário", "temporario", "atual", "correta", "correto", "guia", "app", "aplicativo", "aqui", "ali", "lá",
  "below", "above", "same", "following", "sent", "new", "current", "temporary", "here", "there", "none", "nenhuma", "nenhum",
  "funciona", "funcionando", "works", "working", "errada", "errado", "wrong", "invalid", "inválida", "inválido", "válida", "válido",
]);

/** Contextos que tornam um número NÃO secreto (antecede imediatamente o valor). */
const NON_SECRET_PREFIX = /(?:^|[\s(])(?:apto|apartamento|ap|unidade|bloco|andar|quarto|sala|casa|n[º°o]\.?|número|numero|nr|rua|av|avenida|lote|vaga|km|cep|tel|telefone|fone|whatsapp|celular|r\$|us\$|\$|€|reserva|confirmação|confirmacao)\.?\s*[:#-]?\s*$/i;
/** Qualificadores logo após o rótulo que indicam código NÃO secreto. */
const NON_SECRET_QUALIFIER = /^\s*(?:d[aoe]s?\s+)?(?:reserva|reservation|confirma[cç][aã]o|confirmation|booking|rastreamento|rastreio|tracking|postal|cep|zip|barras|barcode|[aá]rea|promocional|promo|desconto|discount|voo|flight|produto|product|pedido|order|cupom|coupon|cadastro)/i;

// ───────────────────────────── 1. Estruturais ─────────────────────────────

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const STRUCTURAL: Array<{ re: RegExp; category: SecretCategory }> = [
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, category: "token" },
  { re: /\bsk-(?:proj-|live-|test-|ant-)?[A-Za-z0-9_-]{16,}/g, category: "api_key" },
  { re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, category: "api_key" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, category: "api_key" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, category: "api_key" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, category: "api_key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, category: "api_key" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, category: "api_key" },
  { re: /\bya29\.[0-9A-Za-z_-]{20,}/g, category: "token" },
];
const BEARER = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/g;
const API_LABEL = /\b(?:api[ _-]?key|apikey|chave\s+(?:da\s+|de\s+)?api|client[ _-]?secret|secret[ _-]?key|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|token|secret)\b\s*(?:[:=]|é|is)\s*([`"'“”*]*)([A-Za-z0-9._~+/=-]{12,})/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const URL_SECRET_PARAM =
  /([?&#;](?:token|access_token|refresh_token|id_token|auth|authorization|key|api_key|apikey|secret|client_secret|password|passwd|pass|pwd|senha|sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|code|otp|pin|session|sessionid|sid|jwt|t)=)([^&#\s]+)/gi;
const URL_USERINFO = /^(https?:\/\/)([^/\s@:]+:[^/\s@]+)@/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// ───────────────────────────── 2–4. Contextuais ─────────────────────────────

const PASSWORD_LABELS = "senhas?|passwords?|passcode|passwd|pwd|contrase[nñ]as?|claves?|combina[cç][aã]o|combination|segredo";
const CODE_LABELS = "c[oó]digos?|codes?|pins?";
const DEVICE_LABELS =
  "cadeados?-cofres?|cadeados?|cofres?|fechaduras?|teclados?|keypads?|lockbox(?:es)?|keybox(?:es)?|key\\s+box|port[aã]ozinho|port[aã]o|port[oõ]es|portas?(?!ria|ri[oa])|gates?|doors?|locks?|smart\\s?lock";
const ACCESS_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${PASSWORD_LABELS}|${CODE_LABELS}|${DEVICE_LABELS}|acesso|access|entrada|wi-?fi)(?![\\p{L}])`,
  "iu",
);
const LABEL_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${PASSWORD_LABELS})(?![\\p{L}])|(?<![\\p{L}\\p{N}])(${CODE_LABELS})(?![\\p{L}])|(?<![\\p{L}\\p{N}])(${DEVICE_LABELS})(?![\\p{L}])`,
  "giu",
);
const ASSIGN = /(?:\s*[:=]\s*|\s+[-–—]\s+|(?<![\p{L}])(?:é|eh|is|was|será|sera|seria|are)(?![\p{L}])\s*)/iu;
const ACTION_VERBS = /(?<![\p{L}])(digite|digitar|digita|insira|inserir|insere|use|usar|usa|utilize|utilizar|coloque|colocar|coloca|aperte|type|enter|input|punch\s+in|press)(?![\p{L}])/giu;
const REVERSE_TAIL = new RegExp(
  `^\\s*(?:(?:é|eh|is|será|sera)\\s+(?:a|o|the|sua|seu|your)\\s+(?:${PASSWORD_LABELS}|${CODE_LABELS})|(?:no|na|nos|nas|do|da|at\\s+the|on\\s+the|in\\s+the|for\\s+the|para\\s+o|para\\s+a|pro|pra)\\s+(?:${DEVICE_LABELS}))(?![\\p{L}])`,
  "iu",
);
const WIFI_NEAR = /wi-?fi|wireless|\brede\b|network/i;

/** Fim da frase (ou da linha) a partir de `from`, com teto de caracteres. */
function windowEnd(text: string, from: number, max: number): number {
  const limit = Math.min(text.length, from + max);
  for (let i = from; i < limit; i++) {
    const ch = text[i]!;
    if (ch === "\n") return i;
    if ((ch === "." || ch === "!" || ch === "?") && (i + 1 >= text.length || /\s/.test(text[i + 1]!))) {
      // "7777." termina a frase depois do valor: o valor ainda está antes do ponto
      return i;
    }
  }
  return limit;
}

interface Tok {
  start: number;
  end: number;
  raw: string;
}
function tokens(text: string, from: number, to: number): Tok[] {
  const out: Tok[] = [];
  const re = /\S+/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m && m.index < to; m = re.exec(text)) {
    const end = Math.min(m.index + m[0].length, to);
    out.push({ start: m.index, end, raw: text.slice(m.index, end) });
  }
  return out;
}

/** Dígitos espaçados ("1 2 3 4", "12 34") a partir de `from`, até `to`. */
function spacedDigits(text: string, from: number, to: number): { start: number; end: number } | null {
  const re = /(?<![\p{L}\p{N}])\d(?:[ .\-]?\d){3,15}#?(?![\p{L}\p{N}])/gu;
  re.lastIndex = from;
  const m = re.exec(text);
  if (!m || m.index >= to) return null;
  if (!/[ .\-]/.test(m[0])) return null; // sem espaçamento já é coberto pelo token comum
  if (DATE.test(m[0]) || /^\d{1,2}[.:]\d{2}$/.test(m[0])) return null;
  return { start: m.index, end: Math.min(m.index + m[0].length, to) };
}

export class SecretScrubber {
  readonly id = SECRET_SCRUB_ID;
  readonly version = SECRET_SCRUB_VERSION;

  /** Contrato B2.1 (texto apenas). Use `scan` para status e métricas. */
  apply(text: string): string {
    return this.scan(text).text;
  }

  scan(input: string, hint: ScrubHint = {}): ScrubResult {
    if (typeof input !== "string") throw new TypeError("secret_scrub_input_not_text");
    // 1º remove sentinelas forjadas no texto de entrada; 2º protege os marcadores legítimos.
    const clean = normalizeForScan(input).replace(/[\uE000\uE001]/g, "");
    const light = clean.split(SECRET_MARKER).join(S_SECRET).split(BLOCK_MARKER).join(S_BLOCK);
    const view = detectionView(light);
    const protectedText = view.det;
    if (PRIVATE_KEY.test(protectedText)) return { status: "blocked", text: BLOCK_MARKER, findings: [{ category: "private_key", detector: "structural" }] };

    const spans: Span[] = [];
    const add = (s: Span) => {
      if (s.end <= s.start) return;
      const slice = protectedText.slice(s.start, s.end);
      if (slice.includes(S_SECRET) || slice.includes(S_BLOCK)) return; // já é marcador: nunca re-remove
      if (spans.some((x) => s.start < x.end && x.start < s.end)) return; // não sobrepõe o que já foi removido
      spans.push(s);
    };

    this.structural(protectedText, add);
    this.labelValue(protectedText, add);
    this.actionVerb(protectedText, add);
    this.reverse(protectedText, add);
    this.split(protectedText, hint, add);

    if (spans.length > MAX_FINDINGS_BEFORE_BLOCK) {
      return { status: "blocked", text: BLOCK_MARKER, findings: spans.map(({ category, detector }) => ({ category, detector })) };
    }
    // volta para as posições do texto leve (NFKC pode mudar o tamanho de um caractere)
    const mapped = spans
      .map((x) => ({ start: view.from[x.start]!, end: view.to[x.end - 1]! }))
      .sort((a, b) => a.start - b.start);
    let out = "";
    let at = 0;
    for (const x of mapped) {
      if (x.start < at) {
        at = Math.max(at, x.end);
        continue;
      }
      out += light.slice(at, x.start) + S_SECRET;
      at = x.end;
    }
    out += light.slice(at);
    const text = out.split(S_SECRET).join(SECRET_MARKER).split(S_BLOCK).join(BLOCK_MARKER);
    if (spans.length === 0) {
      // Nada encontrado: o texto legítimo volta BYTE A BYTE (inclusive emojis e forma NFD). Só quando um
      // invisível suspeito (ou sentinela forjada) foi removido a resposta é `sanitized`, com o texto limpo —
      // nunca uma falha: a composição segue com o texto sem o caractere escondido.
      const removed = clean !== input.normalize("NFC");
      if (!removed) return { status: "safe", text: input, findings: [] };
      return { status: "sanitized", text, findings: [{ category: "hidden_character", detector: "normalization" }] };
    }
    const status: ScrubStatus = spans.some((s) => s.certainty === "uncertain") ? "ambiguous" : "sanitized";
    return { status, text, findings: spans.map(({ category, detector }) => ({ category, detector })) };
  }

  private structural(t: string, add: (s: Span) => void): void {
    // URLs primeiro: parâmetros de credencial são da URL, não de um rótulo solto.
    URL_RE.lastIndex = 0;
    for (let m = URL_RE.exec(t); m; m = URL_RE.exec(t)) {
      const url = m[0];
      const ui = URL_USERINFO.exec(url);
      if (ui) add({ start: m.index + ui[1]!.length, end: m.index + ui[1]!.length + ui[2]!.length, category: "url_credential", detector: "url", certainty: "certain" });
      URL_SECRET_PARAM.lastIndex = 0;
      for (let p = URL_SECRET_PARAM.exec(url); p; p = URL_SECRET_PARAM.exec(url)) {
        const start = m.index + p.index + p[1]!.length;
        add({ start, end: start + p[2]!.length, category: "url_credential", detector: "url", certainty: "certain" });
      }
    }
    for (const { re, category } of STRUCTURAL) {
      re.lastIndex = 0;
      for (let m = re.exec(t); m; m = re.exec(t)) add({ start: m.index, end: m.index + m[0].length, category, detector: "structural", certainty: "certain" });
    }
    BEARER.lastIndex = 0;
    for (let m = BEARER.exec(t); m; m = BEARER.exec(t)) {
      const start = m.index + m[0].length - m[2]!.length;
      add({ start, end: m.index + m[0].length, category: "token", detector: "structural", certainty: "certain" });
    }
    API_LABEL.lastIndex = 0;
    for (let m = API_LABEL.exec(t); m; m = API_LABEL.exec(t)) {
      if (!hasDigit(m[2]!) && !/[A-Z]/.test(m[2]!)) continue;
      const start = m.index + m[0].length - m[2]!.length;
      add({ start, end: m.index + m[0].length, category: "api_key", detector: "structural", certainty: "certain" });
    }
    // alta entropia fora de URLs (UUID canônico é identificador, não segredo)
    const outsideUrls = t.replace(URL_RE, (u) => " ".repeat(u.length));
    const long = /[A-Za-z0-9_\-+/=]{32,}/g;
    for (let m = long.exec(outsideUrls); m; m = long.exec(outsideUrls)) {
      const v = m[0];
      if (UUID.test(v) || !/[A-Za-z]/.test(v) || !hasDigit(v) || entropy(v) < 3.5) continue;
      add({ start: m.index, end: m.index + v.length, category: "token", detector: "entropy", certainty: "uncertain" });
    }
  }

  private labelValue(t: string, add: (s: Span) => void): void {
    LABEL_RE.lastIndex = 0;
    for (let m = LABEL_RE.exec(t); m; m = LABEL_RE.exec(t)) {
      const kind: "password" | "code" | "device" = m[1] ? "password" : m[2] ? "code" : "device";
      const labelEnd = m.index + m[0].length;
      const tail = t.slice(labelEnd);
      if ((kind === "code" || kind === "device") && NON_SECRET_QUALIFIER.test(tail)) continue;
      const end = windowEnd(t, labelEnd, kind === "password" ? 80 : 48);
      const region = t.slice(labelEnd, end);
      let assign = ASSIGN.exec(region);
      // Um marcador de atribuição só vale se nada com dígito aparece ANTES dele (senão é de outro item:
      // "senha 4821 e token: …").
      if (assign && /\d/.test(region.slice(0, assign.index))) assign = null;
      const explicit = !!assign && /[:=]/.test(assign[0]);
      const valueFrom = assign ? labelEnd + assign.index + assign[0].length : labelEnd;
      const before = t.slice(Math.max(0, m.index - 30), m.index) + m[0];
      const category: SecretCategory = kind === "password" ? (WIFI_NEAR.test(before) || WIFI_NEAR.test(region.slice(0, (assign?.index ?? 0) + 1)) ? "wifi_secret" : "password") : "access_code";

      // Rótulo no fim da linha ("Senha:" ⏎ "1234"): o valor está no começo da próxima linha.
      let from = valueFrom;
      let to = end;
      const restOfLine = t.slice(valueFrom, end);
      if (t[end] === "\n" && /^[\s*`"'“”:=\-–]*$/.test(restOfLine)) {
        from = end + 1;
        to = windowEnd(t, from, 40);
      }
      const spaced = spacedDigits(t, from, to);
      for (const tok of tokens(t, from, to)) {
        if (spaced && tok.start >= spaced.start - 1 && tok.start < spaced.end) {
          add({ start: spaced.start, end: spaced.end, category, detector: "label_value", certainty: "certain" });
          break;
        }
        const c = core(tok.raw);
        if (!c.text) continue;
        if (c.text.includes(S_SECRET) || c.text.includes(S_BLOCK)) break; // já protegido
        const prefix = t.slice(Math.max(0, tok.start - 20), tok.start);
        if (NON_SECRET_PREFIX.test(prefix)) continue;
        const wrapped = c.offset > 0 && WRAP_OPEN.includes(tok.raw[0]!) && /[*`"'“”‘’«»]/.test(tok.raw[0]!);
        const minLen = kind === "device" && !explicit ? 4 : 3;
        const deviceOk = kind !== "device" || explicit || /[#*]/.test(c.text) || (c.text.match(/\d/g)?.length ?? 0) >= 4;
        const isCode = codeLike(c.text, minLen) && deviceOk;
        const isWord = kind === "password" && (explicit || wrapped) && wordSecret(c.text);
        if (isCode || isWord) {
          add({ start: tok.start + c.offset, end: tok.start + c.offset + c.text.length, category, detector: "label_value", certainty: "certain" });
          break;
        }
        // depois de atribuição explícita, só o PRIMEIRO token conta (evita apagar texto adiante)
        if (explicit && !STOPWORDS.has(c.text.toLowerCase())) break;
      }
    }
  }

  private actionVerb(t: string, add: (s: Span) => void): void {
    ACTION_VERBS.lastIndex = 0;
    for (let m = ACTION_VERBS.exec(t); m; m = ACTION_VERBS.exec(t)) {
      const from = m.index + m[0].length;
      const lineStart = t.lastIndexOf("\n", m.index) + 1;
      const lineEndRaw = t.indexOf("\n", from);
      const lineEnd = lineEndRaw < 0 ? t.length : lineEndRaw;
      if (!ACCESS_WORDS.test(t.slice(Math.max(lineStart, m.index - 120), Math.min(lineEnd, from + 120)))) continue;
      const end = windowEnd(t, from, 30);
      for (const tok of tokens(t, from, end)) {
        const c = core(tok.raw);
        if (!c.text || STOPWORDS.has(c.text.toLowerCase())) continue;
        const prefix = t.slice(Math.max(0, tok.start - 20), tok.start);
        if (codeLike(c.text, 3) && !NON_SECRET_PREFIX.test(prefix)) {
          add({ start: tok.start + c.offset, end: tok.start + c.offset + c.text.length, category: "access_code", detector: "action_verb", certainty: "certain" });
        }
        break;
      }
    }
  }

  private reverse(t: string, add: (s: Span) => void): void {
    for (const tok of tokens(t, 0, t.length)) {
      const c = core(tok.raw);
      if (!c.text || !codeLike(c.text, 4)) continue;
      const digits = c.text.match(/\d/g)?.length ?? 0;
      if (digits < 4 && !/[#*]/.test(c.text)) continue;
      const after = t.slice(tok.end, tok.end + 40);
      if (!REVERSE_TAIL.test(after)) continue;
      if (NON_SECRET_PREFIX.test(t.slice(Math.max(0, tok.start - 20), tok.start))) continue;
      add({ start: tok.start + c.offset, end: tok.start + c.offset + c.text.length, category: "access_code", detector: "reverse", certainty: "uncertain" });
    }
  }

  private split(t: string, hint: ScrubHint, add: (s: Span) => void): void {
    const prev = typeof hint.previous === "string" ? detectionView(normalizeForScan(hint.previous)).det : "";
    if (!prev) return;
    const words = t.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) return;
    const dangling = new RegExp(`(?:${PASSWORD_LABELS}|${CODE_LABELS}|${DEVICE_LABELS})[^\\n.!?]{0,40}?(?:[:=]|é|eh|is|será)?\\s*[*\`"'“”]*\\s*$`, "iu").test(prev.trimEnd());
    const accessy = ACCESS_WORDS.test(prev);
    if (!dangling && !accessy) return;
    for (const tok of tokens(t, 0, t.length)) {
      const c = core(tok.raw);
      if (!c.text) continue;
      const digits = c.text.match(/\d/g)?.length ?? 0;
      if (codeLike(c.text, dangling ? 3 : 4) && (dangling || digits >= 4 || /[#*]/.test(c.text))) {
        add({ start: tok.start + c.offset, end: tok.start + c.offset + c.text.length, category: "access_code", detector: "split_message", certainty: "uncertain" });
      }
    }
  }
}

/** Instância padrão (sem estado: pode ser compartilhada). */
export const SECRET_SCRUBBER = Object.freeze(new SecretScrubber());

/** Conta achados por categoria (métrica sem conteúdo). */
export function countByCategory(findings: readonly ScrubFinding[]): Partial<Record<SecretCategory, number>> {
  const out: Partial<Record<SecretCategory, number>> = {};
  for (const f of findings) out[f.category] = (out[f.category] ?? 0) + 1;
  return out;
}
