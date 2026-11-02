/**
 * F2-B · B1 — Schema da DECISÃO do modelo e parse ESTRITO (puro).
 *
 * O modelo devolve JSON; só os metadados são estruturados — o `reply` é texto livre.
 * Estrito = chaves exatas (nenhuma a mais, nenhuma a menos), tipos exatos, enums fechados e
 * limites de tamanho. Qualquer divergência ⇒ `null` (o Orchestrator cai no fallback
 * `invalid_decision`). O parse não interpreta intenção nem corrige o modelo.
 */
import { isCapabilityId } from "./capabilities";
import { CASE_RELATIONS, HANDOFF_URGENCIES, STRATEGIES, type ModelDecision } from "./contracts";

export const DECISION_LIMITS = {
  replyMaxChars: 4_000,
  questionMaxChars: 500,
  itemMaxChars: 300,
  listMaxItems: 20,
  sourceIdPattern: /^[a-z][a-z0-9_]*:[\w:.\-]{1,120}$/i,
} as const;

const TOP_KEYS = ["strategy", "reply", "handoff", "caseRelation", "groundedOn", "missingInformation", "capabilityNeeds", "credentialIntent", "commitments"] as const;
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

/** Valida e normaliza a decisão. `null` = decisão inválida. */
export function parseModelDecision(raw: unknown): ModelDecision | null {
  if (!isObj(raw) || !exactKeys(raw, TOP_KEYS)) return null;

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
  };
}

/** Descrição do formato, para o prompt (B2 compõe; B1 garante que o texto e o parser concordam). */
export const DECISION_FORMAT_SPEC = `Responda APENAS com um objeto JSON com exatamente estas chaves:
{"strategy": "answer"|"clarify"|"guide"|"suggest_alternatives"|"handoff"|"answer_and_handoff",
 "reply": string (mensagem ao hóspede, no idioma dele; vazia só em "handoff"),
 "handoff": {"needed": boolean, "question": string|null (pergunta objetiva à equipe), "urgency": "low"|"normal"|"high"|null},
 "caseRelation": "related"|"independent"|"ambiguous"|"new"|"no_open_case",
 "groundedOn": [ids das fontes do contexto usadas],
 "missingInformation": [string],
 "capabilityNeeds": [{"capability": string, "reason": string}],
 "credentialIntent": "none"|"would_deliver",
 "commitments": [string]}`;
