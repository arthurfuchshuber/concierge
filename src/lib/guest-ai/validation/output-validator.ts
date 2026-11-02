/**
 * F2-B · B1 — OUTPUT VALIDATOR (puro).
 *
 * Bloqueia só o que é segurança e integridade (fallback humano). NÃO é censura de estilo: não
 * há lista de frases proibidas, nem filtro de desculpas, emojis, humor ou idioma. Escopo B1:
 *  - estrutura e coerência da decisão (resposta presente, encaminhamento coerente);
 *  - credenciais: o modelo nunca as recebe, então qualquer código de acesso no texto é fabricado;
 *    o marcador `[[CREDENCIAIS]]` precisa estar coerente com a intenção declarada e com a D9;
 *  - fundamento: ids citados precisam existir no contexto (quando a composição fornece ids);
 *  - posse humana por assunto (via `case-ownership`).
 * Falhas do provedor (truncada, filtrada, vazia) já chegam como falha do Gateway.
 */
import { CREDENTIAL_MARKER, type ModelDecision, type ValidationBlock, type ValidationReport } from "@/lib/guest-ai/orchestrator/contracts";
import type { CaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";

export interface ValidationInput {
  decision: ModelDecision;
  /** Decisão da D9 calculada pelo sistema (sem valores). */
  credentialPolicy: "allow" | "deny";
  ownership: CaseOwnership;
  sourceIds: ReadonlySet<string> | null;
}

export const REPLY_MAX_CHARS = 4_000;

/**
 * Padrões ESTRUTURAIS de código de acesso fabricado (não de estilo):
 *  - dígitos colados ao marcador (o modelo "preencheu" o marcador);
 *  - sequência de 3+ dígitos (ou alfanumérica com dígito) até ~30 caracteres depois de uma
 *    palavra de acesso (senha, código, PIN, cadeado, fechadura, cofre, portão, password, code…).
 * Horários ("15h", "15:00") e datas não casam: exigem a palavra de acesso antes e sequência sem ":".
 */
const ACCESS_WORDS = "senha|c[oó]digo|pin|cadeado|fechadura|cofre|port[aã]o|password|passcode|code|contrase[nñ]a|clave|keypad|lockbox";
const FABRICATED_NEAR_WORD = new RegExp(`(?:${ACCESS_WORDS})[^\\n]{0,30}?(?<![\\d:/.,])\\b(?=[A-Za-z0-9#*]*\\d)[A-Za-z0-9#*]{3,12}\\b(?![:/.,]?\\d)`, "iu");
const DIGITS_AT_MARKER = new RegExp(`${escapeRegExp(CREDENTIAL_MARKER)}\\s*[:=\\-–]?\\s*\\d{3,}|\\d{3,}\\s*[:=\\-–]?\\s*${escapeRegExp(CREDENTIAL_MARKER)}`, "u");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Palavras comuns depois de "senha/código" ("do Wi-Fi", "temporária") não casam: o token exige dígito. */
export function looksLikeFabricatedCredential(reply: string): boolean {
  if (DIGITS_AT_MARKER.test(reply)) return true;
  return FABRICATED_NEAR_WORD.test(reply.replaceAll(CREDENTIAL_MARKER, " "));
}

export function validateDecision(input: ValidationInput): ValidationReport {
  const { decision: d, credentialPolicy, ownership, sourceIds } = input;
  const blocks: ValidationBlock[] = [];
  const add = (b: ValidationBlock) => {
    if (!blocks.includes(b)) blocks.push(b);
  };

  // 1) Estrutura e coerência
  if (d.strategy !== "handoff" && !d.reply) add("reply_missing");
  if (d.reply.length > REPLY_MAX_CHARS) add("reply_too_long");
  const wantsHandoff = d.strategy === "handoff" || d.strategy === "answer_and_handoff";
  if (wantsHandoff !== d.handoff.needed) add("handoff_inconsistent");
  if (d.handoff.needed && !d.handoff.question) add("handoff_inconsistent");

  // 2) Credenciais (o modelo nunca vê códigos)
  const markerCount = d.reply.split(CREDENTIAL_MARKER).length - 1;
  if (markerCount > 1) add("credential_marker_repeated");
  if (markerCount > 0 && d.credentialIntent === "none") add("credential_marker_without_intent");
  if (d.credentialIntent === "would_deliver" && markerCount === 0) add("credential_intent_without_marker");
  if (d.credentialIntent === "would_deliver" && credentialPolicy !== "allow") add("credential_intent_against_policy");
  if (looksLikeFabricatedCredential(d.reply)) add("possible_fabricated_credential");

  // 3) Fundamento
  if (sourceIds && d.groundedOn.some((id) => !sourceIds.has(id))) add("grounding_unknown_source");

  // 4) Posse humana por assunto
  if (ownership.relationMissing) add("case_relation_missing");
  if (ownership.gate.humanOwnsTopic && d.commitments.length > 0) add("human_owned_topic_commitment");
  if (ownership.gate.needsClarification && d.strategy !== "clarify") add("ambiguous_case_requires_clarify");

  return { verdict: blocks.length ? "block" : "pass", blocks };
}
