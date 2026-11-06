/**
 * F2-B · B2.5 — VERIFICAÇÃO INDEPENDENTE DO TEXTO DA RESPOSTA contra a decisão estruturada (pura).
 *
 * Problema (bloqueio crítico herdado da B2.3/B2.4): o modelo pode prometer algo SÓ no texto
 * ("já confirmei sua entrada antecipada para as 12h") com `commitmentKinds: []`. A validação não
 * pode confiar só no que o próprio modelo declarou: este módulo lê o TEXTO e confronta.
 *
 * Como (sem catálogo de frases proibidas e sem censura de estilo):
 *  - a resposta é dividida em orações; em cada uma procuram-se TRAÇOS combinados — objeto de domínio
 *    (entrada antecipada, saída tardia, reserva, disponibilidade, credenciais, equipe, benefício,
 *    incidente), predicado de ação operacional, agente/modalidade (promessa, conclusão, estado) e
 *    atenuadores (negação, condição, oferta, dependência). Um traço isolado não basta: "senha" numa
 *    oração informativa não é promessa; "vou" sem objeto operacional também não;
 *  - permissão com horário é comparada ao horário OFICIAL do imóvel: "pode entrar às 12h" com
 *    check-in oficial às 15h é promessa de entrada antecipada mesmo sem a palavra "antecipada";
 *  - afirmações retrospectivas só passam quando o SISTEMA tem evidência (D9 permite credenciais;
 *    R6 autorizado com o mesmo horário; atendimento humano ativo para "a equipe já está cuidando");
 *  - incerteza é fail-closed: predicado operacional + objeto sem modalidade clara, permissão com
 *    horário sem horário oficial conhecido, ou idioma sem léxico suportado (PT/EN/ES) ⇒ recusa.
 *
 * Limitação declarada: é um analisador determinístico de traços, não compreensão plena. Ironia,
 * paráfrases distantes e idiomas fora de PT/EN/ES não são cobertos (os últimos são recusados).
 * A B3 pode acrescentar um classificador independente pela porta `TextCommitmentClassifier`.
 */
import type { CommitmentKind, ModelDecision, PromisedTime } from "@/lib/guest-ai/orchestrator/contracts";

export const TEXT_COMMITMENT_VERSION = "text-commitment.2026-11-03.1";

export type TextClaimModality = "promise" | "completed";
export interface TextClaim {
  kind: CommitmentKind;
  modality: TextClaimModality;
  /** Horários HH:MM citados na mesma oração. */
  times: string[];
  clause: number;
}
export interface TextAnalysis {
  version: string;
  language: "pt" | "en" | "es" | "mixed" | "unsupported" | "empty";
  claims: TextClaim[];
  /** Orações com ação operacional sobre objeto de domínio sem modalidade classificável. */
  unclassifiable: number;
}

/** Contexto mínimo para interpretar permissões com horário (horários oficiais locais, HH:MM). */
export interface TextContext {
  officialCheckin: string | null;
  officialCheckout: string | null;
}

/** Evidência que o SISTEMA tem para afirmações retrospectivas. */
export interface TextEvidence {
  credentialReleaseAllowed: boolean;
  lateCheckoutAuthorizedTime: string | null;
  humanOwnershipActive: boolean;
}

export const TEXT_BLOCKS = ["text_commitment_undeclared", "text_completion_without_evidence", "text_commitment_unclassifiable", "text_time_mismatch"] as const;
export type TextBlock = (typeof TEXT_BLOCKS)[number];

export interface TextCheck {
  blocks: TextBlock[];
  detectedKinds: CommitmentKind[];
  undeclaredKinds: CommitmentKind[];
  language: TextAnalysis["language"];
}

/** Porta para um classificador independente adicional (B3). Nunca substitui esta verificação. */
export interface TextCommitmentClassifier {
  classify(reply: string): TextAnalysis;
}

// ─────────────────────────── traços (léxico pequeno, por domínio) ───────────────────────────

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const has = (c: string, re: RegExp) => re.test(c);
type Lang = "pt" | "en" | "es";

const FUNCTION_WORDS: Record<Lang, RegExp> = {
  pt: /\b(vou|vamos|pode|podem|agora|nao|voce|voces|de|do|da|dos|das|no|na|nos|nas|em|um|uma|e|ou|com|ate|seu|sua|seus|suas|isso|esta|estao|tem|ja|tambem|obrigad\w*|entao|aqui|muito|tudo|sem|mais|o|os|as|ao|pelo|pela)\b/g,
  en: /\b(the|you|your|and|is|are|will|can|we|i|for|with|this|that|have|has|please|thanks|of|to|in|on|at|it|my|be|until)\b/g,
  es: /\b(el|los|las|del|al|usted|ustedes|y|en|un|una|con|es|su|sus|esta|puede|voy|ya|tambien|gracias|muy|todo|sin|hasta|le|lo)\b/g,
};

/** Objetos de domínio → tipo de compromisso. */
const OBJECTS: ReadonlyArray<[CommitmentKind, RegExp]> = [
  ["early_checkin", /\b(entrada antecipada|check.?in antecipado|antecipar (a |o )?(entrada|check.?in)|entrar (mais )?cedo|chegar antes do horario|early check.?in|check in early|entrada anticipada|llegar antes)\b/],
  ["late_checkout", /\b(saida tardia|late check.?out|check.?out (mais )?tarde|sair (mais )?tarde|estender (a |o )?(saida|check.?out)|check out late|salida tardia|salir mas tarde)\b/],
  ["reservation_change", /\b(reserva|datas?|estadia|noites?|booking|reservation|dates?|stay|nights?|reservacion|fechas?)\b/],
  ["availability", /\b(disponivel|disponiveis|disponibilidade|livre|available|availability|vacancy|disponible|libre)\b/],
  ["credential_release", /\b(senhas?|codigos? de acesso|codigos?|credenciais|acessos?|chaves?|pin|passwords?|access codes?|credentials|keys?|contrasenas?|claves?|acceso)\b/],
  ["service_or_benefit", /\b(desconto|cortesia|gratuit\w+|gratis|sem custo|reembolso|brinde|upgrade|discount|free of charge|complimentary|refund|descuento)\b/],
  ["resolution", /\b(problema|defeito|vazamento|conserto|chuveiro|ar.?condicionado|internet|wi.?fi|issue|problem|leak|repair|averia|fuga)\b/],
];
const TEAM = /\b(equipe|anfitri\w+|atendente|responsavel|host|team|staff|equipo|anfitrion\w*)\b/;
/** Alteração de reserva exige verbo de MUDANÇA (status "confirmada" é informação, não alteração). */
const CHANGE = /\b(alter\w*|mud\w*|troc\w*|estend\w*|prorrog\w*|cancel\w*|antecip\w*|adi\w*|chang\w*|extend\w*|modif\w*|cambi\w*|reschedul\w*)\b/;
/** Disponibilidade só é afirmação sobre o IMÓVEL/DATAS (não "as senhas ficam disponíveis no guia"). */
const LODGING = /\b(datas?|noites?|imovel|apartamento|flat|casa|quarto|unidade|studio|dates?|nights?|apartment|room|unit|property|fechas?|noches?|departamento|habitacion)\b/;
const NEGATION: Record<Lang | "mixed", RegExp> = {
  pt: /\b(nao|nunca|jamais)\b/,
  en: /\b(not|never|cannot|can't|won't|don't)\b/,
  es: /\b(no|nunca|jamas)\b/,
  mixed: /\b(nao|nunca|not|never|cannot|can't|won't|jamas)\b/,
};

const STEMS = "liber|confirm|autoriz|aprov|aprob|garant|reserv|alter|mud|troc|cambi|prorrog|estend|providenc|envi|avis|acion|repass|encaminh|contat|consert|arrum|arregl|conced|ofere|ofrec|cancel|reembols|bloque|agend|resolv";
const ACTION = new RegExp(`\\b((${STEMS})\\w*|guarante\\w*|book\\w*|chang\\w*|extend\\w*|arrang\\w*|send\\w*|sent|notif\\w*|forward\\w*|escalat\\w*|contact\\w*|fix\\w*|grant\\w*|offer\\w*|refund\\w*|schedul\\w*|release\\w*|approv\\w*|authoriz\\w*|confirm\\w*|ped\\w*|otorg\\w*)\\b`);
/** 1ª pessoa no passado/presente de verbos operacionais ("liberei", "confirmamos", "i've sent", "he enviado"). */
const FIRST_PERSON_DONE = new RegExp(`\\b((${STEMS}|resolv|fi[zc]|consegu)\\w*(ei|amos|emos|imos|i)\\b|consegui|i have|i've|we have|we've|he (liberado|confirmado|enviado|avisado|resuelto)|hemos)\\b`);
const RELAY = /\b(avis\w*|notif\w*|acion\w*|repass\w*|encaminh\w*|forward\w*|escalat\w*|contat\w*|contact\w*|ped\w* (a|para|a la) (equipe|anfitri\w*|equipo)|falar com|chamar|let (the )?(team|host) know|tell (the )?(team|host)|avisar al|contactar)\b/;
const ASK_TEAM_TO_EVALUATE = /\b(avali\w*|verific\w*|consult\w*|ver se|check (with|if|whether)|evaluat\w*|review|revis\w*)\b/;

const PROMISE = /\b(vou|vamos|irei|iremos|pode deixar|garanto|garantimos|fica (garantid|confirmad|liberad|reservad|combinad|aprovad)\w*|i will|i'll|we will|we'll|i guarantee|voy a|vamos a|le garantizo|queda (confirmad|garantizad|reservad)\w*)\b/;
const COMPLETED_STATE = /\b(ja (foi|foram|esta|estao|ficou|ficaram)|foi (liberad|confirmad|aprovad|autorizad|resolvid|consertad|enviad|reservad|alterad|providenciad)\w*|(esta|estao) (liberad|confirmad|aprovad|autorizad|resolvid|consertad|garantid|reservad)\w*|has been|have been|was (released|confirmed|approved|fixed|resolved|sent|arranged)|(is|are) (confirmed|approved|authorized|guaranteed|booked|fixed|resolved|released)|already|ya (esta|fue)|(esta|estan) (confirmad|aprobad|autorizad)\w*)\b/;
const HEDGES: Record<Lang, RegExp> = {
  pt: /\b(se|caso|quando|assim que|a partir d\w*|depende\w*|sujeit\w*|posso (verificar|consultar|pedir|ver)|pode ser que|talvez|infelizmente|precis\w* de autoriza\w*|nao|nunca|sem autoriza\w*)\b/,
  en: /\b(if|when|once|unless|depends?|subject to|i can (check|ask)|let me check|can't|cannot|not|unfortunately|requires? (approval|authorization)|never)\b/,
  es: /\b(si|cuando|depende|puedo (verificar|consultar|preguntar)|lamentablemente|no|nunca|sin autoriza\w*)\b/,
};
/** Idioma misto: união dos atenuadores, sem os ambíguos entre línguas ("se", "si", "no"). */
const MIXED_HEDGE = /\b(caso|quando|assim que|a partir d\w*|depende\w*|sujeit\w*|posso (verificar|consultar|pedir|ver)|pode ser que|talvez|infelizmente|nao|nunca|if|when|once|unless|depends?|subject to|let me check|can't|cannot|not|unfortunately|never|cuando|puedo (verificar|consultar)|lamentablemente)\b/;
/** Permissão concedida ao hóspede (entrar/sair/ficar) — interpretada contra os horários oficiais. */
const ENTRY_GRANT = /\b(pode(m)? (entrar|chegar|fazer (o )?check.?in)|liberad\w* (para|a) entrada|you can (check in|arrive|come in|enter)|puede(n)? (entrar|llegar|hacer (el )?check.?in))\b/;
const EXIT_GRANT = /\b(pode(m)? (sair|ficar|fazer (o )?check.?out)|you can (check out|stay|leave)|puede(n)? (salir|quedarse|hacer (el )?check.?out))\b/;
/** Horários: 13:00, 13h, 13h30, 13 horas, 1 pm, meio-dia. */
const TIME = /\b(\d{1,2})(?:(?::|h)(\d{2}))?\s*(h\b|horas\b|hrs?\b|am\b|pm\b)?|\b(meio.?dia|meia.?noite|noon|midnight|mediodia|medianoche)\b/g;

function timesIn(c: string): string[] {
  const out: string[] = [];
  for (const m of c.matchAll(TIME)) {
    if (m[4]) {
      out.push(/meia|midnight|medianoche/.test(m[4]) ? "00:00" : "12:00");
      continue;
    }
    const marked = m[0].includes(":") || /\dh/.test(m[0]);
    const suffix = (m[3] ?? "").trim();
    if (!marked && !suffix) continue; // número solto não é horário
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    if (suffix === "pm" && h < 12) h += 12;
    if (suffix === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return out;
}

function language(text: string): TextAnalysis["language"] {
  const words = text.match(/[a-z]+/g) ?? [];
  if (words.length === 0) return "empty";
  const hits = (Object.keys(FUNCTION_WORDS) as Lang[]).map((l) => [l, (text.match(FUNCTION_WORDS[l]) ?? []).length] as const).sort((a, b) => b[1] - a[1]);
  if (hits[0]![1] === 0) return words.length >= 4 ? "unsupported" : "empty";
  if (hits[1]![1] > 0 && hits[1]![1] >= hits[0]![1]) return "mixed";
  return hits[0]![0];
}

export interface TextClaimDetail extends TextClaim {
  firstPerson: boolean;
}

/** Analisa o texto final da resposta. Pura e determinística. */
export function analyzeReplyCommitments(reply: string, ctx: TextContext): TextAnalysis & { claims: TextClaimDetail[]; grantsWithoutOfficialTime: number } {
  const text = strip(String(reply ?? "").replaceAll("[[CREDENCIAIS]]", " "));
  const lang = language(text);
  const hedgeRe = lang === "pt" || lang === "en" || lang === "es" ? HEDGES[lang] : MIXED_HEDGE;
  const claims: TextClaimDetail[] = [];
  let unclassifiable = 0;
  let grantsWithoutOfficialTime = 0;
  // Oração = trecho entre pontuações (vírgula inclusive): atenuadores valem só onde aparecem.
  const clauses = text.split(/[.!?;,\n]+|\s(?:mas|porem|but|pero)\s/).map((c) => c.trim()).filter(Boolean);
  clauses.forEach((c, i) => {
    const hedged = has(c, hedgeRe);
    const promise = has(c, PROMISE);
    const firstDone = has(c, FIRST_PERSON_DONE);
    const done = firstDone || has(c, COMPLETED_STATE);
    const action = has(c, ACTION);
    const times = timesIn(c);
    const push = (kind: CommitmentKind, modality: TextClaimModality) => claims.push({ kind, modality, times, clause: i, firstPerson: firstDone || promise });

    const negRe = lang === "pt" || lang === "en" || lang === "es" ? NEGATION[lang] : NEGATION.mixed;
    const negated = has(c, negRe);
    // 1) Acionar/contatar a equipe: o pedido à equipe é o compromisso; o assunto do pedido não é promessa.
    //    "vou verificar com a equipe se…": a condição é sobre o RESULTADO, o contato é prometido.
    if (has(c, TEAM)) {
      const relay = has(c, RELAY);
      const ask = has(c, ASK_TEAM_TO_EVALUATE);
      if (!negated && promise && (relay || ask)) return push("team_relay", "promise");
      if (!hedged && relay && done) return push("team_relay", "completed");
      if (!hedged && relay && ask) return push("team_relay", "promise");
      // "a equipe já está cuidando/ciente": estado do atendimento humano (evidência conferida depois).
      if (!hedged && has(c, COMPLETED_STATE) && /\b(cuidando|ciente|acompanhando|tratando|aware|handling|on it|al tanto|atendiendo)\b/.test(c)) return push("team_relay", "completed");
    }
    if (hedged) {
      // Condição, oferta, dependência ou negação: informação, não compromisso.
      return;
    }
    const found = new Set<CommitmentKind>();

    // 2) Permissões com horário, contra o horário OFICIAL (sentido, não palavra-chave).
    if (times.length && (has(c, ENTRY_GRANT) || has(c, EXIT_GRANT))) {
      const entry = has(c, ENTRY_GRANT);
      const official = entry ? ctx.officialCheckin : ctx.officialCheckout;
      if (!official) grantsWithoutOfficialTime += 1;
      else if (times.some((t) => (entry ? t < official : t > official))) found.add(entry ? "early_checkin" : "late_checkout");
    }

    // 3) Objeto de domínio + ação/estado + modalidade.
    let objectHit = false;
    for (const [kind, re] of OBJECTS) {
      if (!has(c, re)) continue;
      objectHit = true;
      if (kind === "reservation_change" && !has(c, CHANGE)) continue;
      if (kind === "availability") {
        // afirmar disponibilidade do imóvel/datas = compromisso de disponibilidade (exige consulta)
        if (has(c, LODGING)) found.add(kind);
        continue;
      }
      const strong = kind === "early_checkin" || kind === "late_checkout" || kind === "service_or_benefit";
      if (done && (action || strong || kind === "credential_release" || kind === "resolution" || kind === "reservation_change")) found.add(kind);
      else if (promise && (action || strong || kind === "reservation_change")) found.add(kind);
      else if (action && (strong || kind === "reservation_change" || kind === "credential_release")) unclassifiable += 1;
    }
    // 4) Execução concluída em 1ª pessoa sem objeto reconhecido ("já providenciei", "i've sent it").
    if (!objectHit && firstDone && action) found.add("action_completed");

    for (const kind of found) push(kind, done && !promise ? "completed" : "promise");
  });
  return { version: TEXT_COMMITMENT_VERSION, language: lang, claims, unclassifiable, grantsWithoutOfficialTime };
}

/**
 * Confronta o texto com a decisão estruturada e com a evidência do sistema. Fail-closed:
 *  - promessa no texto sem o tipo em `commitmentKinds` ⇒ `text_commitment_undeclared`;
 *  - conclusão/estado afirmado sem evidência do sistema ⇒ `text_completion_without_evidence`;
 *  - horário no texto diferente do estruturado (ou do R6) ⇒ `text_time_mismatch`;
 *  - oração não classificável, permissão sem horário oficial ou idioma não suportado ⇒ `text_commitment_unclassifiable`.
 * A AUTORIZAÇÃO de cada tipo declarado continua no validador semântico (`COMMITMENT_AUTHORIZATION`).
 */
export function checkReplyAgainstDecision(d: ModelDecision, ctx: TextContext, ev: TextEvidence): TextCheck {
  const blocks = new Set<TextBlock>();
  const reply = d.reply ?? "";
  if (!reply.trim()) return { blocks: [], detectedKinds: [], undeclaredKinds: [], language: "empty" };
  const a = analyzeReplyCommitments(reply, ctx);
  if (a.language === "unsupported" || a.unclassifiable > 0 || a.grantsWithoutOfficialTime > 0) blocks.add("text_commitment_unclassifiable");
  const declared = new Set<CommitmentKind>(d.commitmentKinds ?? []);
  const promised: readonly PromisedTime[] = d.promisedTimes ?? [];
  const undeclared = new Set<CommitmentKind>();
  for (const c of a.claims) {
    if (c.modality === "completed") {
      // Só afirmações de ESTADO comprovado pelo sistema passam; "fiz/liberei/avisei" (1ª pessoa) nunca:
      // a IA não executa nada nesta arquitetura.
      const evidenced =
        !c.firstPerson &&
        ((c.kind === "credential_release" && ev.credentialReleaseAllowed) ||
          (c.kind === "late_checkout" && ev.lateCheckoutAuthorizedTime !== null && c.times.every((t) => t === ev.lateCheckoutAuthorizedTime)) ||
          (c.kind === "team_relay" && ev.humanOwnershipActive));
      if (!evidenced) {
        if (c.kind === "late_checkout" && ev.lateCheckoutAuthorizedTime !== null && c.times.length) blocks.add("text_time_mismatch");
        else blocks.add("text_completion_without_evidence");
      }
      continue;
    }
    if (!declared.has(c.kind)) {
      undeclared.add(c.kind);
      blocks.add("text_commitment_undeclared");
    }
    if ((c.kind === "late_checkout" || c.kind === "early_checkin") && c.times.length) {
      const p = promised.find((x) => x.kind === c.kind);
      if (!p || c.times.some((t) => t !== p.time)) blocks.add("text_time_mismatch");
    }
  }
  return { blocks: [...blocks], detectedKinds: [...new Set(a.claims.map((c) => c.kind))], undeclaredKinds: [...undeclared], language: a.language };
}
