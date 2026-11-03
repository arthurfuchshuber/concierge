/**
 * F2-B · B1 — Schema da DECISÃO do modelo e parse ESTRITO (puro).
 *
 * O modelo devolve JSON; só os metadados são estruturados — o `reply` é texto livre.
 * Estrito = chaves exatas (nenhuma a mais, nenhuma a menos), tipos exatos, enums fechados e
 * limites de tamanho. Qualquer divergência ⇒ `null` (o Orchestrator cai no fallback
 * `invalid_decision`). O parse não interpreta intenção nem corrige o modelo.
 */
import { CAPABILITY_IDS, isCapabilityId } from "./capabilities";
import {
  CASE_RELATIONS,
  CREDENTIAL_MARKER,
  FORMAL_CHANGE_KINDS,
  HANDOFF_URGENCIES,
  HOSPITALITY_MILESTONES,
  INTENT_CATEGORIES,
  STRATEGIES,
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
} as const;

const TOP_KEYS = ["strategy", "reply", "handoff", "caseRelation", "groundedOn", "missingInformation", "capabilityNeeds", "credentialIntent", "commitments"] as const;
/** B2.1 (decisão v2): todas juntas ou nenhuma. */
const V2_KEYS = ["shouldReply", "intents", "formalChangeRequests", "hospitalityMilestone", "speakerName"] as const;
const MILESTONE_KEYS = ["kind", "evidence"] as const;
const HANDOFF_KEYS = ["needed", "question", "urgency"] as const;
const NEED_KEYS = ["capability", "reason"] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o: Obj, keys: readonly string[]) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};
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

/**
 * Valida e normaliza a decisão. `null` = decisão inválida.
 * Versões: v1 (B1, exatamente `TOP_KEYS`) ou v2 (B2.1, `TOP_KEYS` + TODAS as `V2_KEYS`).
 * Mistura parcial é inválida. Uma v1 com `silence` passa no parser e é bloqueada no Validator
 * (`silence_strategy_mismatch`): v1 sempre significa responder.
 */
export function parseModelDecision(raw: unknown): ModelDecision | null {
  if (!isObj(raw)) return null;
  const isV1 = exactKeys(raw, TOP_KEYS);
  const isV2 = !isV1 && exactKeys(raw, [...TOP_KEYS, ...V2_KEYS]);
  if (!isV1 && !isV2) return null;

  // Coerência (ex.: `silence` numa v1, que sempre significa responder) é do Validator, não do parser.
  if (!inEnum(raw["strategy"], STRATEGIES)) return null;
  if (typeof raw["reply"] !== "string" || raw["reply"].length > DECISION_LIMITS.replyMaxChars) return null;

  const h = raw["handoff"];
  if (!isObj(h) || !exactKeys(h, HANDOFF_KEYS) || typeof h["needed"] !== "boolean") return null;
  const question = h["question"];
  if (question !== null && (typeof question !== "string" || question.length > DECISION_LIMITS.questionMaxChars)) return null;
  const urgency = h["urgency"];
  if (urgency !== null && !inEnum(urgency, HANDOFF_URGENCIES)) return null;

  if (!inEnum(raw["caseRelation"], CASE_RELATIONS)) return null;
  if (raw["credentialIntent"] !== "none" && raw["credentialIntent"] !== "would_deliver") return null;

  const groundedOn = stringList(raw["groundedOn"], DECISION_LIMITS.listMaxItems, 130, DECISION_LIMITS.sourceIdPattern);
  const missing = stringList(raw["missingInformation"], DECISION_LIMITS.listMaxItems, DECISION_LIMITS.itemMaxChars);
  const commitments = stringList(raw["commitments"], DECISION_LIMITS.listMaxItems, DECISION_LIMITS.itemMaxChars);
  if (!groundedOn || !missing || !commitments) return null;

  const needsRaw = raw["capabilityNeeds"];
  if (!Array.isArray(needsRaw) || needsRaw.length > DECISION_LIMITS.listMaxItems) return null;
  const capabilityNeeds: ModelDecision["capabilityNeeds"] = [];
  for (const n of needsRaw) {
    if (!isObj(n) || !exactKeys(n, NEED_KEYS) || !isCapabilityId(n["capability"])) return null;
    if (typeof n["reason"] !== "string" || !n["reason"].trim() || n["reason"].length > DECISION_LIMITS.itemMaxChars) return null;
    capabilityNeeds.push({ capability: n["capability"], reason: n["reason"].trim() });
  }

  const v2 = isV2 ? parseV2(raw) : null;
  if (isV2 && !v2) return null;

  return {
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
  };
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
 "speakerName": string|null (nome que o interlocutor declarou nesta conversa, até ${DECISION_LIMITS.speakerNameMaxChars} caracteres; não é prova de identidade)}
Listas com no máximo ${DECISION_LIMITS.listMaxItems} itens.`;
