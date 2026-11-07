/**
 * F2-B · B1 — Schema da DECISÃO do modelo e parse ESTRITO (puro).
 *
 * O modelo devolve JSON; só os metadados são estruturados — o `reply` é texto livre.
 * Estrito = chaves exatas (nenhuma a mais, nenhuma a menos), tipos exatos, enums fechados e
 * limites de tamanho. Qualquer divergência ⇒ `null` (o Orchestrator cai no fallback
 * `invalid_decision`). O parse não interpreta intenção nem corrige o modelo.
 *
 * B2.3: `parseDecision` devolve ERRO TIPADO (`DECISION_PARSE_ERRORS`, sem valores da saída),
 * aceita v1/v2/v3 (compatibilidade preservada), recusa chaves de escopo/identidade em qualquer nível
 * e pode exigir a versão que o prompt pediu. `parseDecisionText` cobre JSON malformado/truncado/vazio.
 * `parseModelDecision` (B1) continua com o mesmo comportamento para seus consumidores.
 */
import { CAPABILITY_IDS, isCapabilityId } from "./capabilities";
import {
  CASE_RELATIONS,
  COMMITMENT_KINDS,
  TEMPORAL_COMMITMENT_KINDS,
  type PromisedTime,
  GUEST_ETA_CARDS,
  type GuestEta,
  CREDENTIAL_MARKER,
  FORMAL_CHANGE_KINDS,
  HANDOFF_URGENCIES,
  HOSPITALITY_MILESTONES,
  INTENT_CATEGORIES,
  STRATEGIES,
  type CommitmentKind,
  type DecisionContractVersion,
  type FormalChangeKind,
  type IntentCategory,
  type ModelDecision,
} from "./contracts";

export const DECISION_LIMITS = {
  replyMaxChars: 4_000,
  questionMaxChars: 500,
  itemMaxChars: 300,
  listMaxItems: 20,
  sourceIdPattern: /^[a-z][a-z0-9_]*:[\w:.\-]{1,120}$/i,
  // B2.1
  intentsMaxItems: 5,
  milestoneEvidenceMaxItems: 5,
  speakerNameMaxChars: 80,
  // G2 (v5)
  quoteMaxChars: 200,
} as const;

const TOP_KEYS = ["strategy", "reply", "handoff", "caseRelation", "groundedOn", "missingInformation", "capabilityNeeds", "credentialIntent", "commitments"] as const;
/** B2.1 (decisão v2): todas juntas ou nenhuma. */
const V2_KEYS = ["shouldReply", "intents", "formalChangeRequests", "hospitalityMilestone", "speakerName"] as const;
/** B2.3 (decisão v3): exige TODAS as chaves v2 + estas. */
const V3_KEYS = ["commitmentKinds"] as const;
/** B2.5 (decisão v4): exige TODAS as chaves v3 + esta. */
const V4_KEYS = ["promisedTimes"] as const;
/** G2 (decisão v5): exige TODAS as chaves v4 + estas. */
const V5_KEYS = ["guestEtas", "milestoneQuote"] as const;
const KNOWN_KEYS: readonly string[] = [...TOP_KEYS, ...V2_KEYS, ...V3_KEYS, ...V4_KEYS, ...V5_KEYS];
const GUEST_ETA_KEYS = ["card", "date", "time", "evidence", "quote"] as const;
const PROMISED_TIME_KEYS = ["kind", "date", "time", "timezone"] as const;
const DATE_ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const TZ_IANA = /^[A-Za-z]+(?:\/[A-Za-z0-9_+\-]+){1,2}$/;

const MILESTONE_KEYS = ["kind", "evidence"] as const;
const HANDOFF_KEYS = ["needed", "question", "urgency"] as const;
const NEED_KEYS = ["capability", "reason"] as const;

/** Versão do parser (registrada na auditoria da cadeia). */
export const DECISION_PARSER_VERSION = "decision-parser.2026-11-06.5";
/** Teto do texto bruto aceito em `parseDecisionText` (a saída do turno tem teto de 1.024 tokens). */
export const DECISION_TEXT_MAX_CHARS = 32_000;

/**
 * Chaves de ESCOPO/IDENTIDADE que o modelo nunca pode declarar (tenant, imóvel, reserva, conversa,
 * usuário, audiência, autorização). Comparação normalizada (minúsculas, sem `_`/`-`). Presença ⇒
 * `scope_field_forbidden` — o escopo vem só do turno validado, nunca da saída do modelo.
 */
const SCOPE_KEYS: readonly string[] = [
  "tenantid", "tenant", "ownerid", "accountid", "propertyid", "property", "reservationid", "reservation", "bookingid",
  "conversationid", "messageid", "userid", "guestid", "sessionid", "audience", "audiences", "scope", "authorization",
  "authorized", "permissions", "permission", "grant", "grants", "role",
  // B2.5 — identidade de envio: conta/canal remetente e anúncio nunca vêm do modelo
  "senderchannelid", "senderchannel", "channelid", "senderid", "sender", "senderidentity", "listingid", "listing",
];
const isScopeKey = (k: string) => SCOPE_KEYS.includes(k.toLowerCase().replace(/[_\-\s]/g, ""));

/** Erros tipados do parser. Nunca carregam valores da saída do modelo — só código e nome de campo do CONTRATO. */
export const DECISION_PARSE_ERRORS = [
  "not_text",
  "empty_output",
  "output_too_large",
  "malformed_json",
  "truncated_json",
  "not_object",
  "scope_field_forbidden",
  "unexpected_field",
  "missing_field",
  "mixed_version",
  "version_mismatch",
  "invalid_strategy",
  "invalid_reply",
  "invalid_handoff",
  "invalid_case_relation",
  "invalid_credential_intent",
  "invalid_list",
  "invalid_capability",
  "invalid_signals",
  "invalid_commitment_kinds",
  "invalid_promised_times",
  // G2 (v5)
  "invalid_guest_etas",
  "invalid_milestone_quote",
] as const;
export type DecisionParseErrorCode = (typeof DECISION_PARSE_ERRORS)[number];

/** Campos do contrato (nome fixo, nunca vindo da saída). */
export type DecisionField = (typeof TOP_KEYS)[number] | (typeof V2_KEYS)[number] | (typeof V3_KEYS)[number] | (typeof V4_KEYS)[number] | (typeof V5_KEYS)[number] | null;

export interface DecisionParseError {
  code: DecisionParseErrorCode;
  /** Campo do contrato envolvido (de lista fixa). Chaves desconhecidas NUNCA são ecoadas. */
  field: DecisionField;
  /** Quantas chaves desconhecidas havia (o nome delas não é registrado: poderia conter segredo). */
  unexpectedCount?: number;
}

export type DecisionParseResult =
  | { ok: true; decision: ModelDecision; version: DecisionContractVersion }
  | { ok: false; error: DecisionParseError };

export interface DecisionParseOptions {
  /** Exige uma versão específica do contrato (a cadeia B2.3 exige a que o prompt pediu). */
  expectVersion?: DecisionContractVersion;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exactKeys = (o: Obj, keys: readonly string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};
const has = (o: Obj, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const inEnum = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === "string" && (values as readonly string[]).includes(v);

function stringList(v: unknown, maxItems: number, maxChars: number, pattern?: RegExp): string[] | null {
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    const t = item.trim();
    if (!t || t.length > maxChars) return null;
    if (pattern && !pattern.test(t)) return null;
    out.push(t);
  }
  return out;
}

function uniqueEnumList<T extends string>(v: unknown, values: readonly T[], min: number, max: number): T[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  if (!v.every((x) => inEnum(x, values))) return null;
  if (new Set(v).size !== v.length) return null;
  return [...(v as T[])];
}

/** Sinais B2.1 (v2). `null` = inválidos. */
function parseV2(raw: Obj): Pick<Required<ModelDecision>, (typeof V2_KEYS)[number]> | null {
  if (typeof raw["shouldReply"] !== "boolean") return null;
  const intents = uniqueEnumList<IntentCategory>(raw["intents"], INTENT_CATEGORIES, 1, DECISION_LIMITS.intentsMaxItems);
  const changes = uniqueEnumList<FormalChangeKind>(raw["formalChangeRequests"], FORMAL_CHANGE_KINDS, 0, FORMAL_CHANGE_KINDS.length);
  if (!intents || !changes) return null;
  const m = raw["hospitalityMilestone"];
  let milestone: ModelDecision["hospitalityMilestone"] = null;
  if (m !== null) {
    if (!isObj(m) || !exactKeys(m, MILESTONE_KEYS) || !inEnum(m["kind"], HOSPITALITY_MILESTONES)) return null;
    const evidence = stringList(m["evidence"], DECISION_LIMITS.milestoneEvidenceMaxItems, 130, DECISION_LIMITS.sourceIdPattern);
    if (!evidence || evidence.length === 0) return null;
    milestone = { kind: m["kind"], evidence: [...new Set(evidence)] };
  }
  const name = raw["speakerName"];
  if (name !== null && (typeof name !== "string" || !name.trim() || name.trim().length > DECISION_LIMITS.speakerNameMaxChars)) return null;
  return {
    shouldReply: raw["shouldReply"],
    intents,
    formalChangeRequests: changes,
    hospitalityMilestone: milestone,
    speakerName: typeof name === "string" ? name.trim() : null,
  };
}

/** B2.5: horários prometidos — formato estrito (data ISO, HH:MM 24 h, fuso IANA), sem repetir domínio. */
function parsePromisedTimes(v: unknown): PromisedTime[] | null {
  if (!Array.isArray(v) || v.length > TEMPORAL_COMMITMENT_KINDS.length) return null;
  const out: PromisedTime[] = [];
  for (const p of v) {
    if (!isObj(p) || !exactKeys(p, PROMISED_TIME_KEYS)) return null;
    if (!inEnum(p["kind"], TEMPORAL_COMMITMENT_KINDS)) return null;
    if (typeof p["date"] !== "string" || !DATE_ISO.test(p["date"])) return null;
    if (typeof p["time"] !== "string" || !TIME_HM.test(p["time"])) return null;
    if (typeof p["timezone"] !== "string" || !TZ_IANA.test(p["timezone"])) return null;
    if (out.some((x) => x.kind === p["kind"])) return null;
    out.push({ kind: p["kind"], date: p["date"], time: p["time"], timezone: p["timezone"] });
  }
  return out;
}

/** G2: previsões do hóspede — no máximo uma por card, data ISO, HH:MM, evidência por id e trecho literal. */
function parseGuestEtas(v: unknown): GuestEta[] | null {
  if (!Array.isArray(v) || v.length > GUEST_ETA_CARDS.length) return null;
  const out: GuestEta[] = [];
  for (const e of v) {
    if (!isObj(e) || !exactKeys(e, GUEST_ETA_KEYS)) return null;
    if (!inEnum(e["card"], GUEST_ETA_CARDS)) return null;
    if (typeof e["date"] !== "string" || !DATE_ISO.test(e["date"])) return null;
    if (typeof e["time"] !== "string" || !TIME_HM.test(e["time"])) return null;
    const evidence = stringList(e["evidence"], DECISION_LIMITS.milestoneEvidenceMaxItems, 130, DECISION_LIMITS.sourceIdPattern);
    if (!evidence || evidence.length === 0) return null;
    const quote = e["quote"];
    if (typeof quote !== "string" || !quote.trim() || quote.trim().length > DECISION_LIMITS.quoteMaxChars) return null;
    if (out.some((x) => x.card === e["card"])) return null;
    out.push({ card: e["card"], date: e["date"], time: e["time"], evidence: [...new Set(evidence)], quote: quote.trim() });
  }
  return out;
}

/** Procura chave de escopo em qualquer objeto da decisão (topo e aninhados). */
function findScopeKey(v: unknown, depth = 0): boolean {
  if (depth > 4 || !v || typeof v !== "object") return false;
  if (Array.isArray(v)) return v.some((x) => findScopeKey(x, depth + 1));
  return Object.keys(v as Obj).some((k) => isScopeKey(k) || findScopeKey((v as Obj)[k], depth + 1));
}

const fail = (code: DecisionParseErrorCode, field: DecisionField = null, extra: Partial<DecisionParseError> = {}): DecisionParseResult => ({
  ok: false,
  error: { code, field, ...extra },
});

/**
 * Valida e normaliza a decisão com ERRO TIPADO. Versões (compatíveis entre si):
 *  - v1 (B1): exatamente `TOP_KEYS`;
 *  - v2 (B2.1): `TOP_KEYS` + TODAS as `V2_KEYS`;
 *  - v3 (B2.3): v2 + `commitmentKinds`.
 * Mistura parcial é inválida (`mixed_version`). Chave de escopo/identidade ⇒ `scope_field_forbidden`.
 * O parser não interpreta intenção, não corrige o modelo e não infere autorização: coerência entre
 * campos e autorização são do Validator (estrutural) e do Validador Semântico.
 */
export function parseDecision(raw: unknown, options: DecisionParseOptions = {}): DecisionParseResult {
  if (!isObj(raw)) return fail("not_object");
  if (findScopeKey(raw)) return fail("scope_field_forbidden");
  const keys = Object.keys(raw);
  const unknown = keys.filter((k) => !KNOWN_KEYS.includes(k));
  if (unknown.length) return fail("unexpected_field", null, { unexpectedCount: unknown.length });
  const missingTop = TOP_KEYS.find((k) => !has(raw, k));
  if (missingTop) return fail("missing_field", missingTop);
  const v2Present = V2_KEYS.filter((k) => has(raw, k)).length;
  const v3Present = V3_KEYS.filter((k) => has(raw, k)).length;
  const v4Present = V4_KEYS.filter((k) => has(raw, k)).length;
  const v5Present = V5_KEYS.filter((k) => has(raw, k)).length;
  if (
    (v2Present > 0 && v2Present < V2_KEYS.length) ||
    (v3Present > 0 && v2Present !== V2_KEYS.length) ||
    (v4Present > 0 && (v4Present !== V4_KEYS.length || v3Present !== V3_KEYS.length || v2Present !== V2_KEYS.length)) ||
    (v5Present > 0 && (v5Present !== V5_KEYS.length || v4Present !== V4_KEYS.length || v3Present !== V3_KEYS.length || v2Present !== V2_KEYS.length))
  ) {
    return fail(
      "mixed_version",
      V2_KEYS.find((k) => !has(raw, k)) ?? V3_KEYS.find((k) => !has(raw, k)) ?? V4_KEYS.find((k) => !has(raw, k)) ?? V5_KEYS.find((k) => !has(raw, k)) ?? null,
    );
  }
  const version: DecisionContractVersion = v5Present ? 5 : v4Present ? 4 : v3Present ? 3 : v2Present ? 2 : 1;
  if (options.expectVersion !== undefined && options.expectVersion !== version) return fail("version_mismatch");

  // Coerência (ex.: `silence` numa v1, que sempre significa responder) é do Validator, não do parser.
  if (!inEnum(raw["strategy"], STRATEGIES)) return fail("invalid_strategy", "strategy");
  if (typeof raw["reply"] !== "string" || raw["reply"].length > DECISION_LIMITS.replyMaxChars) return fail("invalid_reply", "reply");

  const h = raw["handoff"];
  if (!isObj(h) || !exactKeys(h, HANDOFF_KEYS) || typeof h["needed"] !== "boolean") return fail("invalid_handoff", "handoff");
  const question = h["question"];
  if (question !== null && (typeof question !== "string" || question.length > DECISION_LIMITS.questionMaxChars)) return fail("invalid_handoff", "handoff");
  const urgency = h["urgency"];
  if (urgency !== null && !inEnum(urgency, HANDOFF_URGENCIES)) return fail("invalid_handoff", "handoff");

  if (!inEnum(raw["caseRelation"], CASE_RELATIONS)) return fail("invalid_case_relation", "caseRelation");
  if (raw["credentialIntent"] !== "none" && raw["credentialIntent"] !== "would_deliver") return fail("invalid_credential_intent", "credentialIntent");

  const groundedOn = stringList(raw["groundedOn"], DECISION_LIMITS.listMaxItems, 130, DECISION_LIMITS.sourceIdPattern);
  if (!groundedOn) return fail("invalid_list", "groundedOn");
  const missing = stringList(raw["missingInformation"], DECISION_LIMITS.listMaxItems, DECISION_LIMITS.itemMaxChars);
  if (!missing) return fail("invalid_list", "missingInformation");
  const commitments = stringList(raw["commitments"], DECISION_LIMITS.listMaxItems, DECISION_LIMITS.itemMaxChars);
  if (!commitments) return fail("invalid_list", "commitments");

  const needsRaw = raw["capabilityNeeds"];
  if (!Array.isArray(needsRaw) || needsRaw.length > DECISION_LIMITS.listMaxItems) return fail("invalid_capability", "capabilityNeeds");
  const capabilityNeeds: ModelDecision["capabilityNeeds"] = [];
  for (const n of needsRaw) {
    if (!isObj(n) || !exactKeys(n, NEED_KEYS) || !isCapabilityId(n["capability"])) return fail("invalid_capability", "capabilityNeeds");
    if (typeof n["reason"] !== "string" || !n["reason"].trim() || n["reason"].length > DECISION_LIMITS.itemMaxChars) return fail("invalid_capability", "capabilityNeeds");
    capabilityNeeds.push({ capability: n["capability"], reason: n["reason"].trim() });
  }

  const v2 = version >= 2 ? parseV2(raw) : null;
  if (version >= 2 && !v2) return fail("invalid_signals");
  let commitmentKinds: CommitmentKind[] | undefined;
  if (version >= 3) {
    const kinds = uniqueEnumList<CommitmentKind>(raw["commitmentKinds"], COMMITMENT_KINDS, 0, COMMITMENT_KINDS.length);
    if (!kinds) return fail("invalid_commitment_kinds", "commitmentKinds");
    commitmentKinds = kinds;
  }
  let promisedTimes: PromisedTime[] | undefined;
  if (version >= 4) {
    promisedTimes = parsePromisedTimes(raw["promisedTimes"]) ?? undefined;
    if (!promisedTimes) return fail("invalid_promised_times", "promisedTimes");
  }
  let guestEtas: GuestEta[] | undefined;
  let milestoneQuote: string | null | undefined;
  if (version === 5) {
    guestEtas = parseGuestEtas(raw["guestEtas"]) ?? undefined;
    if (!guestEtas) return fail("invalid_guest_etas", "guestEtas");
    const mq = raw["milestoneQuote"];
    if (mq !== null && (typeof mq !== "string" || !mq.trim() || mq.trim().length > DECISION_LIMITS.quoteMaxChars))
      return fail("invalid_milestone_quote", "milestoneQuote");
    milestoneQuote = typeof mq === "string" ? mq.trim() : null;
  }

  const decision: ModelDecision = {
    strategy: raw["strategy"],
    reply: raw["reply"].trim(),
    handoff: {
      needed: h["needed"],
      question: typeof question === "string" && question.trim() ? question.trim() : null,
      urgency: urgency ?? null,
    },
    caseRelation: raw["caseRelation"],
    groundedOn: [...new Set(groundedOn)],
    missingInformation: missing,
    capabilityNeeds,
    credentialIntent: raw["credentialIntent"],
    commitments,
    ...(v2 ?? {}),
    ...(commitmentKinds ? { commitmentKinds } : {}),
    ...(promisedTimes ? { promisedTimes } : {}),
    ...(guestEtas ? { guestEtas, milestoneQuote: milestoneQuote ?? null } : {}),
  };
  return { ok: true, decision, version };
}

/**
 * Compatibilidade B1/B2.1: `null` = decisão inválida; aceita v1, v2 e v3. Consumidores atuais
 * (Orchestrator, render) seguem usando esta função sem mudança de comportamento para v1/v2.
 */
export function parseModelDecision(raw: unknown): ModelDecision | null {
  const r = parseDecision(raw);
  return r.ok ? r.decision : null;
}

/** Heurística ESTRUTURAL de truncamento: delimitadores/aspas não fechados ao fim do texto. */
function looksTruncated(t: string): boolean {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (const c of t) {
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") depth -= 1;
  }
  return inStr || depth > 0;
}

/**
 * Parse a partir do TEXTO bruto da saída (defesa em profundidade: o Gateway já recusa JSON
 * inválido, mas a cadeia B2.3 não presume isso). Nunca registra trechos do texto.
 */
export function parseDecisionText(text: unknown, options: DecisionParseOptions = {}): DecisionParseResult {
  if (typeof text !== "string") return fail("not_text");
  const t = text.trim();
  if (!t) return fail("empty_output");
  if (t.length > DECISION_TEXT_MAX_CHARS) return fail("output_too_large");
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return fail(looksTruncated(t) ? "truncated_json" : "malformed_json");
  }
  return parseDecision(raw, options);
}

/**
 * Descrição do formato, para o prompt (B2 compõe). Gerada a partir das MESMAS constantes do parser
 * (estratégias, relações, urgências, capacidades, marcador, limites): texto e parser não divergem.
 */
const q = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join("|");
export const DECISION_FORMAT_SPEC = `Responda APENAS com um objeto JSON com exatamente estas chaves (nenhuma a mais, nenhuma a menos):
{"strategy": ${q(STRATEGIES)},
 "reply": string (mensagem ao hóspede, no idioma do hóspede, até ${DECISION_LIMITS.replyMaxChars} caracteres; vazia só em "handoff"),
 "handoff": {"needed": boolean, "question": string|null (pergunta objetiva à equipe), "urgency": ${q(HANDOFF_URGENCIES)}|null},
 "caseRelation": ${q(CASE_RELATIONS)},
 "groundedOn": [ids das fontes do contexto usadas, exatamente como aparecem no contexto],
 "missingInformation": [string],
 "capabilityNeeds": [{"capability": ${q(CAPABILITY_IDS)}, "reason": string}],
 "credentialIntent": "none"|"would_deliver" (com "would_deliver", escreva ${CREDENTIAL_MARKER} uma única vez no ponto da resposta; nunca escreva códigos ou senhas),
 "commitments": [string] (todo compromisso, promessa de ação ou exceção que a resposta assumir; um por item),
 "shouldReply": boolean (false = não responder; só quando não houver pergunta, pedido, problema, emergência, alteração ou ação necessária; com false, use "strategy": "silence" e "reply": ""),
 "intents": [${q(INTENT_CATEGORIES)}] (de 1 a ${DECISION_LIMITS.intentsMaxItems}, sem repetir: o que o hóspede faz na mensagem atual),
 "formalChangeRequests": [${q(FORMAL_CHANGE_KINDS)}] (alterações pedidas que dependem da reserva ou de autorização formal; vazio se nenhuma),
 "hospitalityMilestone": null | {"kind": ${q(HOSPITALITY_MILESTONES)}, "evidence": [ids das mensagens do hóspede que confirmam o marco, incluindo a mensagem atual]},
 "speakerName": string|null (nome que o interlocutor declarou nesta conversa, até ${DECISION_LIMITS.speakerNameMaxChars} caracteres; não é prova de identidade),
 "commitmentKinds": [${q(COMMITMENT_KINDS)}] (os tipos dos compromissos listados em commitments, sem repetir; vazio se e somente se commitments estiver vazio),
 "promisedTimes": [{"kind": ${q(TEMPORAL_COMMITMENT_KINDS)}, "date": "AAAA-MM-DD", "time": "HH:MM", "timezone": fuso IANA do imóvel}] (todo horário que a resposta prometer para um compromisso temporal; vazio se nenhum),
 "guestEtas": [{"card": ${q(GUEST_ETA_CARDS)}, "date": "AAAA-MM-DD", "time": "HH:MM", "evidence": [ids das mensagens do hóspede com a previsão], "quote": trecho literal da mensagem do hóspede com a previsão, até ${DECISION_LIMITS.quoteMaxChars} caracteres}] (previsão de horário de chegada ou de saída que o PRÓPRIO hóspede informou; no máximo uma por card; vazio se nenhuma),
 "milestoneQuote": string|null (com hospitalityMilestone, o trecho literal da mensagem do hóspede que confirma a entrada ou a saída, até ${DECISION_LIMITS.quoteMaxChars} caracteres; null sem marco)}
Listas com no máximo ${DECISION_LIMITS.listMaxItems} itens.`;
