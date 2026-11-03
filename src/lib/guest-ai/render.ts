/**
 * F2-B · B2.1 — RENDERIZAÇÃO da saída do turno (pura).
 *
 * Transforma o `OrchestratorResult` (B1: decisão já parseada de forma estrita e validada) numa
 * estrutura tipada que SEPARA, sem ambiguidade:
 *  - resposta conversacional (texto ao hóspede) OU decisão de silêncio (`kind: "silence"`);
 *  - categorias de intenção e solicitações de alteração formal;
 *  - compromissos operacionais declarados;
 *  - observações (lacunas de informação e fundamentos citados);
 *  - pedidos ao sistema (credenciais, capacidades futuras) — nunca executáveis;
 *  - necessidade de esclarecimento e de intervenção humana;
 *  - interlocutor (nome declarado, nunca verificado) e titular (não consta);
 *  - reconhecimento de marco da estadia (sem efeito operacional).
 *
 * Garantias:
 *  - nada é executado nem enviado: `delivery: "not_sent"` e `effectsExecuted: false` literais;
 *  - SILÊNCIO é resultado legítimo: sem texto, sem cortesia substituta e sem fallback;
 *  - nada concede autorização: compromissos e alterações formais saem `not_granted` (não existe,
 *    nesta etapa, fonte de autorização para eles — camada da B2.4); a AUSÊNCIA de compromisso
 *    declarado também não autoriza nada; decidir responder, classificar a intenção ou declarar um
 *    nome não autoriza nada;
 *  - decisão bloqueada pela validação não expõe texto conversacional (`conversational: null`);
 *  - a decisão é reconferida pelo MESMO parser estrito da B1 e a coerência do veredito é checada;
 *    qualquer divergência vira `invalid_decision` / `internal_error` (fail-closed).
 *
 * Não há censura de estilo: humor, emojis, informalidade e desculpas contextuais passam intactos.
 * Limitação registrada (diretriz B2.1 §13/D6): a validação é ESTRUTURAL — não garante detectar uma
 * promessa indevida escrita só em linguagem natural sem declaração em `commitments`.
 */
import type { CapabilityId } from "@/lib/guest-ai/orchestrator/capabilities";
import {
  CREDENTIAL_MARKER,
  decisionSignals,
  type FallbackKind,
  type FormalChangeKind,
  type HandoffUrgency,
  type HospitalityMilestoneKind,
  type IntentCategory,
  type ModelCaseRelation,
  type ModelDecision,
  type OrchestratorResult,
  type Strategy,
  type ValidationBlock,
} from "@/lib/guest-ai/orchestrator/contracts";
import { parseModelDecision } from "@/lib/guest-ai/orchestrator/decision";

/** Código do Gateway quando a falha veio dele (derivado do contrato B1, sem importar `llm/`). */
type LlmErrorCode = NonNullable<Extract<OrchestratorResult, { kind: "fallback" }>["llmCode"]>;

export const RENDER_VERSION = "render.2026-11-03.2";

interface NotSent {
  delivery: "not_sent";
  effectsExecuted: false;
}

export interface RenderedFallback extends NotSent {
  kind: "fallback";
  fallback: FallbackKind;
  llmCode: LlmErrorCode | null;
}

/** Silêncio decidido pela inteligência e aprovado pela validação: nada a enviar, e não é erro. */
export interface RenderedSilence extends NotSent {
  kind: "silence";
  intentCategories: IntentCategory[];
  observations: { missingInformation: string[]; groundedOn: string[] };
  speaker: { declaredName: string | null; verified: false };
}

export interface RenderedCommitment {
  text: string;
  authorization: "not_granted";
  executable: false;
}

export interface RenderedDraft extends NotSent {
  kind: "draft";
  verdict: "pass" | "block";
  blocks: ValidationBlock[];
  decisionVersion: 1 | 2 | 3;
  strategy: Strategy;
  /** Texto ao hóspede. `null` quando bloqueado ou quando só há encaminhamento. */
  conversational: { text: string; containsCredentialMarker: boolean } | null;
  intentCategories: IntentCategory[];
  formalChangeRequests: Array<{ kind: FormalChangeKind; status: "requested"; authorization: "not_granted" }>;
  clarification: { requested: boolean };
  humanIntervention: { needed: boolean; question: string | null; urgency: HandoffUrgency | null; withReply: boolean };
  commitments: RenderedCommitment[];
  observations: { missingInformation: string[]; groundedOn: string[] };
  systemRequests: {
    credential: { declared: "none" | "would_deliver"; executable: false };
    capabilities: Array<{ capability: CapabilityId; reason: string; executable: false }>;
  };
  caseRelation: ModelCaseRelation;
  speaker: { declaredName: string | null; verified: false };
  reservationHolder: { status: "not_in_context" };
  hospitalityMilestone: { kind: HospitalityMilestoneKind; evidence: string[]; operationalEffect: "none" } | null;
}

export type RenderedTurn = RenderedFallback | RenderedSilence | RenderedDraft;

const NOT_SENT: NotSent = { delivery: "not_sent", effectsExecuted: false };

function fallback(kind: FallbackKind, llmCode: LlmErrorCode | null = null): RenderedFallback {
  return { kind: "fallback", fallback: kind, llmCode, ...NOT_SENT };
}

function sameDecision(a: ModelDecision, b: ModelDecision): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function renderTurn(result: OrchestratorResult): RenderedTurn {
  if (!result || typeof result !== "object") return fallback("internal_error");
  if (result.kind === "fallback") return fallback(result.fallback, result.llmCode ?? null);
  if (result.kind !== "draft") return fallback("internal_error");

  // Reconferência estrita: a decisão precisa sobreviver ao MESMO parser da B1 sem mudar.
  const reparsed = parseModelDecision(result.decision as unknown);
  if (!reparsed || !sameDecision(reparsed, result.decision)) return fallback("invalid_decision");

  const v = result.validation;
  if (!v || (v.verdict !== "pass" && v.verdict !== "block") || !Array.isArray(v.blocks)) return fallback("internal_error");
  // Veredito coerente: "pass" ⇔ nenhum bloqueio.
  if ((v.verdict === "pass") !== (v.blocks.length === 0)) return fallback("internal_error");

  const d = reparsed;
  const sig = decisionSignals(d);
  const passed = v.verdict === "pass";
  const speaker = { declaredName: sig.speakerName, verified: false as const };
  const observations = { missingInformation: [...d.missingInformation], groundedOn: [...d.groundedOn] };

  // Silêncio aprovado: resultado legítimo, sem texto e sem cortesia/fallback substituto.
  if (passed && !sig.shouldReply) {
    return { kind: "silence", intentCategories: [...sig.intents], observations, speaker, ...NOT_SENT };
  }

  const conversational = passed && d.reply ? { text: d.reply, containsCredentialMarker: d.reply.includes(CREDENTIAL_MARKER) } : null;
  return {
    kind: "draft",
    verdict: v.verdict,
    blocks: [...v.blocks],
    decisionVersion: sig.version,
    strategy: d.strategy,
    conversational,
    intentCategories: [...sig.intents],
    formalChangeRequests: sig.formalChangeRequests.map((kind) => ({ kind, status: "requested", authorization: "not_granted" })),
    clarification: { requested: d.strategy === "clarify" },
    humanIntervention: {
      needed: d.handoff.needed,
      question: d.handoff.question,
      urgency: d.handoff.urgency,
      withReply: d.handoff.needed && !!d.reply,
    },
    commitments: d.commitments.map((text) => ({ text, authorization: "not_granted", executable: false })),
    observations,
    systemRequests: {
      credential: { declared: d.credentialIntent, executable: false },
      capabilities: d.capabilityNeeds.map((n) => ({ capability: n.capability, reason: n.reason, executable: false })),
    },
    caseRelation: d.caseRelation,
    speaker,
    reservationHolder: { status: "not_in_context" },
    hospitalityMilestone: sig.hospitalityMilestone ? { ...sig.hospitalityMilestone, operationalEffect: "none" } : null,
    ...NOT_SENT,
  };
}
