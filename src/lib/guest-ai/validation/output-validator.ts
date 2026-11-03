/**
 * F2-B · B1 — OUTPUT VALIDATOR (puro).
 *
 * Bloqueia só o que é segurança e integridade (fallback humano). NÃO é censura de estilo: não
 * há lista de frases proibidas, nem filtro de desculpas, emojis, humor ou idioma. Escopo B1:
 *  - estrutura e coerência da decisão (resposta presente, encaminhamento coerente);
 *  - credenciais: o modelo nunca as recebe, então qualquer código de acesso no texto é fabricado;
 *    o marcador `[[CREDENCIAIS]]` precisa estar coerente com a intenção declarada e com a D9;
 *  - fundamento: ids citados precisam existir no contexto (quando a composição fornece ids);
 *  - posse humana por assunto (via `case-ownership`);
 *  - B2.1 (decisão v2), só coerência ESTRUTURAL dos campos tipados: silêncio (`shouldReply`),
 *    intenções, pedidos de alteração formal e marcos de hospitalidade. Nenhuma regra lê o texto da
 *    resposta para julgar estilo; e nenhuma garante detectar promessa escrita só em linguagem natural
 *    sem declaração em `commitments` (limitação registrada para as próximas etapas).
 * B2.3: campos de encaminhamento incompatíveis e coerência dos tipos de compromisso (v3). A
 * validação SEMÂNTICA (autorização de compromissos, contexto, dossiê, marcos, saída sensível) é
 * camada independente: `validation/semantic-validator.ts`.
 * Falhas do provedor (truncada, filtrada, vazia) já chegam como falha do Gateway.
 */
import {
  CREDENTIAL_MARKER,
  SILENCE_COMPATIBLE_INTENTS,
  commitmentKindsOf,
  decisionSignals,
  type ModelDecision,
  type ValidationBlock,
  type ValidationReport,
} from "@/lib/guest-ai/orchestrator/contracts";
import type { CaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { DECISION_LIMITS } from "@/lib/guest-ai/orchestrator/decision";

export interface ValidationInput {
  decision: ModelDecision;
  /** Decisão da D9 calculada pelo sistema (sem valores). */
  credentialPolicy: "allow" | "deny";
  ownership: CaseOwnership;
  sourceIds: ReadonlySet<string> | null;
}

/** Mesmo limite do parser (fonte única). */
export const REPLY_MAX_CHARS = DECISION_LIMITS.replyMaxChars;

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

  const sig = decisionSignals(d);

  // 1) Estrutura e coerência
  if (d.strategy !== "handoff" && d.strategy !== "silence" && !d.reply) add("reply_missing");
  if (d.reply.length > REPLY_MAX_CHARS) add("reply_too_long");
  const wantsHandoff = d.strategy === "handoff" || d.strategy === "answer_and_handoff";
  if (wantsHandoff !== d.handoff.needed) add("handoff_inconsistent");
  if (d.handoff.needed && !d.handoff.question) add("handoff_inconsistent");
  // B2.3: campos mutuamente incompatíveis — pergunta/urgência à equipe sem encaminhamento.
  if (!d.handoff.needed && (d.handoff.question !== null || d.handoff.urgency !== null)) add("handoff_fields_without_need");

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

  // 5) B2.1 — silêncio: legítimo, explícito e só quando nada exige resposta
  if ((d.strategy === "silence") !== !sig.shouldReply) add("silence_strategy_mismatch");
  if (!sig.shouldReply && d.reply) add("silence_with_reply");
  if (
    !sig.shouldReply &&
    (sig.intents.some((i) => !SILENCE_COMPATIBLE_INTENTS.includes(i)) ||
      d.handoff.needed ||
      d.commitments.length > 0 ||
      d.credentialIntent !== "none" ||
      sig.formalChangeRequests.length > 0 ||
      sig.hospitalityMilestone !== null)
  ) {
    add("silence_not_allowed");
  }

  // 6) B2.1 — alteração formal (datas, hóspedes, valores, cancelamento, early/late…): nunca compromisso
  if (sig.intents.includes("formal_change_request") !== sig.formalChangeRequests.length > 0) add("formal_change_inconsistent");
  if (sig.formalChangeRequests.length > 0 && d.commitments.length > 0) add("formal_change_commitment");

  // 7) B2.1 — marco de hospitalidade: coerente com a intenção e provado pela mensagem ATUAL do hóspede
  const m = sig.hospitalityMilestone;
  if (m) {
    const needed = m.kind === "checkin_confirmed" ? "arrival_confirmation" : "departure_confirmation";
    if (!sig.intents.includes(needed)) add("milestone_inconsistent");
    const current = currentGuestRef(sourceIds);
    const allGuest = m.evidence.every((id) => GUEST_REF.test(id) && !!sourceIds && sourceIds.has(id));
    if (!current || !allGuest || !m.evidence.includes(current)) add("milestone_without_current_guest_evidence");
  }

  // 8) B2.3 (v3) — tipos de compromisso coerentes com a lista de compromissos (estrutural).
  //    A AUTORIZAÇÃO de cada tipo é do Validador Semântico (`semantic-validator.ts`).
  const kinds = commitmentKindsOf(d);
  if (kinds !== null && ((kinds.length > 0) !== (d.commitments.length > 0) || kinds.length > d.commitments.length)) {
    add("commitment_kinds_inconsistent");
  }

  // 9) B2.5 (v4) — todo horário prometido corresponde a um tipo de compromisso declarado.
  if (d.promisedTimes && d.promisedTimes.some((p) => !(kinds ?? []).includes(p.kind))) add("promised_time_kind_undeclared");
  return { verdict: blocks.length ? "block" : "pass", blocks };
}

/** Ids de mensagens do HÓSPEDE no histórico composto (`composer.ts` / `history.ts`): `hist:guest:hN`. */
const GUEST_REF = /^hist:guest:h(\d+)$/;

/** A mensagem atual é sempre a última do histórico e sempre do hóspede: o maior `hist:guest:hN`. */
export function currentGuestRef(sourceIds: ReadonlySet<string> | null): string | null {
  if (!sourceIds) return null;
  let best: { n: number; id: string } | null = null;
  for (const id of sourceIds) {
    const mm = GUEST_REF.exec(id);
    if (!mm) continue;
    const n = Number(mm[1]);
    if (!best || n > best.n) best = { n, id };
  }
  return best?.id ?? null;
}
