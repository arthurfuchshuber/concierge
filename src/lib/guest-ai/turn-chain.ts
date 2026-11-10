/**
 * F2-B · B2.3 — ENCADEAMENTO FAIL-CLOSED do turno da ConciergeIA Guest.
 *
 * Coordena, numa ordem fixa e declarada, as 11 etapas que vão do turno validado até a decisão final:
 *   1 turno validado → 2 contexto → 3 dossiê → 4 histórico → 5 FreeTextGuard → 6 compositor →
 *   7 saída do modelo → 8 parser → 9 validador estrutural → 10 validador semântico → 11 decisão final.
 * Cada etapa declara pré-condições, resultado e condições de recusa (`CHAIN_STAGES`). Uma falha em
 * etapa crítica NUNCA vira aprovação implícita: a cadeia termina em `refused` ou `technical_error`,
 * sem texto ao hóspede, sem ação e sem "resposta de cortesia" substituta.
 *
 * Isolamento (diretriz B2.3 §2):
 *  - NÃO está ligada ao Orchestrator nem ao slot (`NO_COMPOSER` segue o padrão; teste estático);
 *  - NÃO importa o Gateway nem provedor algum: a saída do modelo chega por `deps.generate`, injetado
 *    (nos testes, um gerador falso). Nada é enviado: todo resultado é `delivery: "not_sent"`;
 *  - NÃO escreve nada e não cria persistência; a auditoria é um evento por lista branca, sem texto.
 *
 * Classificações distintas (§7): `reply` (texto aprovado, não enviado), `silence` (decisão legítima
 * de não responder), `human_action` (só encaminhamento, sem texto ao hóspede), `refused` (recusa de
 * composição ou de saída por política) e `technical_error` (exceção, prazo, falha de leitura). A
 * situação da conversa (chamado já existente, emergência, necessidade humana) vem à parte e nunca
 * transforma uma recusa em autorização para outra ação.
 */
import type { CityEventsLoad } from "./data/city-events.server";
import type { LivingDocumentLoad } from "./learning/learning";
import {
  CURRENT_DECISION_VERSION,
  TURN_MAX_DEADLINE_MS,
  decisionSignals,
  type ComposedPrompt,
  type ConversationContext,
  type DecisionContractVersion,
  type HandoffUrgency,
  type IntentCategory,
  type ModelCaseRelation,
  type ModelDecision,
  type Strategy,
  type ValidationBlock,
  type ValidationReport,
} from "@/lib/guest-ai/orchestrator/contracts";
import { DECISION_PARSER_VERSION, parseDecisionText, type DecisionParseErrorCode } from "@/lib/guest-ai/orchestrator/decision";
import { resolveCaseOwnership, type CaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { validateDecision } from "@/lib/guest-ai/validation/output-validator";
import { reconcileDecision } from "@/lib/guest-ai/validation/reconcile";
import {
  SEMANTIC_VALIDATOR_VERSION,
  validateSemantics,
  type AvailabilityStatus,
  type PriorMilestones,
  type SemanticBlock,
  type SemanticDossierView,
  type SemanticReport,
} from "@/lib/guest-ai/validation/semantic-validator";
import { COMPOSER_VERSION, composeTurnPrompt, type ComposeUnavailableReason, type FreeTextGuard } from "@/lib/guest-ai/composer";
import type { HistoryResult } from "@/lib/guest-ai/history";
import { buildGuestProfileContext, type GuestProfileContext } from "@/lib/guest-ai/context/guest-profile";
import type { GuestProfileLoad } from "@/lib/guest-ai/data/guest-profile.server";
import type { AvailabilityState, PropertyDossier } from "@/lib/guest-ai/dossier/contracts";
import { isIssued } from "@/lib/guest-ai/trust";
import { deriveHumanOwnership, type ConversationOwnershipRow, type HumanOwnershipSnapshot } from "@/lib/guest-ai/orchestrator/case-ownership";
import { isIssuedBatch, type GuestMessageBatch } from "@/lib/guest-ai/batch/message-batch";
import { resolveSenderIdentity, type SenderIdentity, type SenderIdentitySource } from "@/lib/guest-ai/policy/sender-identity";
import { deriveHumanPause, type HumanPauseSource, type HumanPauseState } from "@/lib/guest-ai/policy/human-pause";
import {
  checkRequestedLateCheckout,
  evaluateStayAuthorizations,
  unavailableStayAuthorizations,
  type StayAuthorizationInput,
  type StayAuthorizations,
} from "@/lib/guest-ai/policy/stay-authorizations";
import { GUEST_SURFACES, type StayPhase, type ValidatedTurn } from "@/lib/guest-ai/types";
import type { BudgetConfig } from "@/lib/guest-ai/budget";

export const TURN_CHAIN_VERSION = "chain.2026-11-03.3";
/** Versão do validador estrutural (o arquivo B1/B2.1/B2.3 `output-validator.ts`). */
export const STRUCTURAL_VALIDATOR_VERSION = "structural.2026-11-03.3";
/** Prazo padrão de cada etapa assíncrona (leitura e modelo). O turno inteiro respeita o teto de 15 s (`TURN_MAX_DEADLINE_MS`). */
export const CHAIN_STAGE_TIMEOUT_MS = 5_000;
/** Teto absoluto que um chamador pode pedir para o turno inteiro (Copiloto/slot, 10/11/2026). */
export const TURN_DEADLINE_CEILING_MS = 30_000;

// Conferência de tipos em compilação: o espelho do validador semântico = o estado do dossiê.
type _AvailabilityMirror = AvailabilityState["status"] extends AvailabilityStatus ? (AvailabilityStatus extends AvailabilityState["status"] ? true : never) : never;
const _availabilityMirror: _AvailabilityMirror = true;
void _availabilityMirror;

// ─────────────────────────── Etapas, pré-condições e recusas ───────────────────────────

export const CHAIN_STAGE_IDS = [
  "turn",
  "context",
  "dossier",
  "history",
  "guard",
  "compose",
  "model_output",
  "parse",
  "structural_validation",
  "semantic_validation",
  "final_decision",
] as const;
export type ChainStageId = (typeof CHAIN_STAGE_IDS)[number];

/** Códigos de recusa por POLÍTICA (não são erro técnico). */
export type ChainRefusalCode =
  // turno
  | "turn_not_validated"
  | "trace_invalid"
  // contexto
  | "context_incomplete"
  | "tenant_unknown"
  | "property_tenant_mismatch"
  | "property_identity_mismatch"
  | "conversation_identity_mismatch"
  | "reservation_conversation_mismatch"
  | "credentials_present"
  | "internal_audience"
  | "context_inconsistent"
  | "credential_policy_inconsistent"
  // B2.4 — atendimento humano: pausa EXPLÍCITA da IA pela equipe; estado de atendimento ilegível
  | "ai_paused_by_team"
  | "human_ownership_inconsistent"
  // B2.5 — lote de mensagens e pausa
  | "batch_not_validated"
  | "batch_scope_mismatch"
  | "batch_turn_mismatch"
  | "batch_history_mismatch"
  | "batch_contains_paused_messages"
  | "reply_during_pause"
  | "paused_decision_invalid"
  // dossiê
  | "dossier_out_of_scope"
  | "dossier_internal_audience"
  // histórico
  | "history_unavailable"
  | "history_scope_mismatch"
  // guard
  | "guard_missing"
  | "guard_failed"
  | "guard_ambiguous"
  | "guard_blocked"
  // composição
  | "compose_unavailable"
  | "compose_over_budget"
  | "grounding_unverifiable"
  // parser
  | `parse_${DecisionParseErrorCode}`
  // validadores
  | "structural_block"
  | "structural_validator_invalid"
  | "semantic_block"
  | "semantic_validator_invalid"
  // decisão final (defesa redundante: incoerência que escapou às camadas anteriores)
  | "final_inconsistent";

/** Códigos de erro TÉCNICO (exceção, prazo, leitura). Nunca viram resposta. */
export type ChainTechnicalCode = "stage_timeout" | "stage_aborted" | "stage_failed" | "model_call_failed" | "validator_exception";

export interface ChainStageSpec {
  order: number;
  id: ChainStageId;
  critical: true;
  preconditions: readonly string[];
  result: string;
  refusals: readonly string[];
}

/** Especificação declarativa da cadeia (fonte única para documentação e testes). */
export const CHAIN_STAGES: readonly ChainStageSpec[] = Object.freeze(([
  { order: 1, id: "turn", critical: true, preconditions: ["ValidatedTurn emitido por validateTurnScope (registro trust.ts)", "traceId opaco válido"], result: "turno confiável (conversa, mensagem, imóvel, tenant, reserva declarada)", refusals: ["turn_not_validated", "trace_invalid"] },
  { order: 2, id: "context", critical: true, preconditions: ["turno validado", "leitura concluída no prazo"], result: "ConversationContext íntegro e do mesmo escopo do turno; atendimento humano por assunto e autorizações formais de horário verificados (B2.4)", refusals: ["context_incomplete", "tenant_unknown", "property_tenant_mismatch", "property_identity_mismatch", "conversation_identity_mismatch", "reservation_conversation_mismatch", "credentials_present", "internal_audience", "context_inconsistent", "credential_policy_inconsistent", "human_ownership_inconsistent", "ai_paused_by_team", "stage_timeout", "stage_failed"] },
  { order: 3, id: "dossier", critical: true, preconditions: ["contexto íntegro", "dossiês emitidos pelo loader (opcional)"], result: "dossiê principal + candidatos do mesmo tenant, só públicos", refusals: ["dossier_out_of_scope", "dossier_internal_audience", "stage_timeout", "stage_failed"] },
  { order: 4, id: "history", critical: true, preconditions: ["contexto íntegro"], result: "histórico integral da mesma conversa até a mensagem atual", refusals: ["history_unavailable", "history_scope_mismatch", "stage_timeout", "stage_failed"] },
  { order: 5, id: "guard", critical: true, preconditions: ["guard com scan", "canário removido", "cada texto safe, ou sanitized com re-varredura confirmatória"], result: "todo texto livre saneado", refusals: ["guard_missing", "guard_failed", "guard_ambiguous", "guard_blocked"] },
  { order: 6, id: "compose", critical: true, preconditions: ["etapas 1–5 aprovadas", "orçamento respeitado"], result: "prompt (system + 1 user) com ids citáveis", refusals: ["compose_unavailable", "compose_over_budget", "grounding_unverifiable"] },
  { order: 7, id: "model_output", critical: true, preconditions: ["prompt composto", "gerador injetado (nunca o Gateway nesta fase)"], result: "texto bruto da saída", refusals: ["model_call_failed", "stage_timeout"] },
  { order: 8, id: "parse", critical: true, preconditions: ["saída textual"], result: `decisão tipada no contrato v${CURRENT_DECISION_VERSION}`, refusals: ["parse_*"] },
  { order: 9, id: "structural_validation", critical: true, preconditions: ["decisão tipada", "ids citáveis disponíveis"], result: "estrutura, credenciais, fundamento, posse humana, silêncio e marcos coerentes", refusals: ["structural_block", "structural_validator_invalid", "validator_exception"] },
  { order: 10, id: "semantic_validation", critical: true, preconditions: ["validação estrutural aprovada"], result: "compromissos autorizados, alteração com rota, alternativas fundamentadas, marcos compatíveis, saída sem segredo", refusals: ["semantic_block", "semantic_validator_invalid", "validator_exception"] },
  { order: 11, id: "final_decision", critical: true, preconditions: ["etapas 1–10 aprovadas"], result: "reply | silence | human_action (nada é enviado)", refusals: ["final_inconsistent"] },
] satisfies ChainStageSpec[]).map((s) => Object.freeze(s)));

// ─────────────────────────── Resultado ───────────────────────────

export interface ChainSituation {
  /** Ação humana requerida pela decisão (encaminhamento estruturado). */
  humanAction: { needed: boolean; urgency: HandoffUrgency | null };
  /** Relação com chamado humano JÁ existente (nunca bloqueio global). */
  existingCase: "none" | "related" | "independent" | "ambiguous" | "new";
  emergency: boolean;
  intents: IntentCategory[];
}

/** Auditoria por LISTA BRANCA: códigos, versões, contagens e duração. Nenhum texto. */
export interface ChainAudit {
  event: "guest_ai.chain";
  chainVersion: string;
  traceId: string | null;
  outcome: ChainOutcome["kind"];
  stage: ChainStageId;
  code: string | null;
  category: "reply" | "silence" | "human_action" | "paused" | "urgent_internal_alert" | "refusal" | "technical_error";
  contractVersion: DecisionContractVersion;
  decisionVersion: DecisionContractVersion | null;
  parserVersion: string;
  structuralValidatorVersion: string;
  semanticValidatorVersion: string;
  composerVersion: string;
  guard: { id: string; version: string } | null;
  structuralBlocks: ValidationBlock[];
  semanticBlocks: SemanticBlock[];
  durationMs: number;
  stagesCompleted: ChainStageId[];
  /** B2.4 — duração por etapa (ms). `guard` = tempo acumulado do FreeTextGuard (entrada e saída). */
  timings: Partial<Record<ChainTimingId, number>>;
  interruption: "none" | "timeout" | "aborted";
  /** B2.4 — resumo da decisão (só enums, contagens e booleanos). `null` antes do parser. */
  decision: ChainDecisionSummary | null;
  /** B2.4 — resultado das verificações de segurança (só códigos e contagens). */
  checks: ChainSecurityChecks;
}

export const CHAIN_TIMING_IDS = ["context", "dossier", "history", "scope_check", "stay_authorizations", "human_ownership", "human_pause", "sender_identity", "guard", "compose", "model_output", "parse", "structural_validation", "semantic_validation", "final_decision"] as const;
export type ChainTimingId = (typeof CHAIN_TIMING_IDS)[number];

export interface ChainDecisionSummary {
  shouldReply: boolean;
  strategy: Strategy;
  intents: IntentCategory[];
  commitmentKinds: string[] | null;
  unauthorizedKinds: string[];
  handoff: { needed: boolean; urgency: HandoffUrgency | null };
  caseRelation: ModelCaseRelation;
  credentialIntent: "none" | "would_deliver";
  milestone: string | null;
}

export interface ChainSecurityChecks {
  context: "ok" | ChainRefusalCode | "not_run";
  dossierScope: "ok" | "not_provided" | ChainRefusalCode | "not_run";
  guard: { safe: number; sanitized: number; ambiguous: number; blocked: number } | null;
  credentialPolicy: "allow" | "deny" | null;
  stayAuthorizations: { earlyCheckin: string; lateCheckout: string } | null;
  humanOwnership: string | null;
  sourceConflicts: number;
  unknownFacts: number;
  /** B2.5 — lote (id técnico e tamanho), identidade de envio, horários prometidos, texto e pausa. */
  batch: { batchId: string; size: number } | null;
  senderIdentity: { status: SenderIdentity["status"]; source: SenderIdentity["source"]; reason: SenderIdentity["reason"] } | null;
  promisedTimes: Array<{ kind: string; result: "valid" | "invalid_commitment_time"; authorizationSource: string | null }>;
  text: { language: string; detectedKinds: string[]; undeclaredKinds: string[] } | null;
  pause: "not_evaluated" | "active" | "inactive";
  /** B3.2 — pausa derivada do histórico (persistidas + brutos + coluna). */
  derivedPause: "not_evaluated" | HumanPauseState["state"];
  alert: "none" | "raised" | "insufficient_evidence";
}

interface NotSent {
  delivery: "not_sent";
  effectsExecuted: false;
}

/** B2.5 — preparação de despacho: identidade de envio resolvida/validada ≠ autorização ≠ envio. */
export interface DispatchPreparation {
  senderIdentity: SenderIdentity | null;
  /** Nunca concedida na B2.5 (porta de efeito explícita só na B3). */
  sendAuthorization: "not_granted";
  state: "blocked_sender_identity" | "awaiting_send_authorization";
}

/** B2.5 — intenção estruturada de alerta interno urgente (emergência com IA pausada). Nada é notificado. */
export interface UrgentInternalAlert {
  kind: "urgent_internal_alert";
  priority: "critical";
  conversationId: string;
  propertyId: string;
  tenantId: string;
  /** Mensagens do hóspede que sustentam a classificação (ids citáveis do histórico). */
  evidenceRefs: string[];
  notified: false;
  delivery: "not_sent";
  effectsExecuted: false;
}

export type ChainOutcome =
  | ({ kind: "reply"; text: string; strategy: Strategy; decision: ModelDecision; situation: ChainSituation; dispatch: DispatchPreparation; audit: ChainAudit } & NotSent)
  | ({ kind: "paused"; situation: ChainSituation; audit: ChainAudit } & NotSent)
  | ({ kind: "urgent_internal_alert"; alert: UrgentInternalAlert; situation: ChainSituation; audit: ChainAudit } & NotSent)
  | ({ kind: "silence"; decision: ModelDecision; situation: ChainSituation; audit: ChainAudit } & NotSent)
  | ({ kind: "human_action"; question: string; decision: ModelDecision; situation: ChainSituation; audit: ChainAudit } & NotSent)
  | ({ kind: "refused"; stage: ChainStageId; code: ChainRefusalCode; situation: ChainSituation | null; audit: ChainAudit } & NotSent)
  | ({ kind: "technical_error"; stage: ChainStageId; code: ChainTechnicalCode; audit: ChainAudit } & NotSent);

// ─────────────────────────── Dependências (todas injetadas) ───────────────────────────

export interface ChainDossiers {
  primary: PropertyDossier;
  candidates?: readonly PropertyDossier[];
}

export interface ChainDeps {
  loadContext: (turn: ValidatedTurn, signal: AbortSignal) => Promise<ConversationContext>;
  loadHistory: (turn: ValidatedTurn, signal: AbortSignal) => Promise<HistoryResult>;
  loadDossiers?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<ChainDossiers | null>;
  /** Gerador da saída do modelo. Nesta fase: SEMPRE um falso de teste (o módulo não importa o Gateway). */
  generate: (prompt: ComposedPrompt, signal: AbortSignal) => Promise<unknown>;
  guard: FreeTextGuard | null;
  priorMilestones?: PriorMilestones;
  /**
   * B2.4 — fonte das autorizações de horário (R6; entrada antecipada sem fonte). A identidade
   * (imóvel, reserva) e o instante vêm SEMPRE do turno/cadeia, nunca desta fonte. Ausente ou falha
   * ⇒ nada autorizado (não recusa o turno: só impede promessas).
   */
  loadStayAuthorizationSource?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<Omit<StayAuthorizationInput, "turn" | "now" | "lookup">>;
  /** B2.5 — fontes da identidade de envio (preferência, gêmeos, contas). Falha ⇒ não resolvida. */
  loadSenderIdentitySource?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<SenderIdentitySource>;
  /**
   * Memória do hóspede recorrente — perfil canônico (só leitura). Enriquecimento: falha ou ausência ⇒
   * `indisponivel` no prompt, nunca recusa o turno. Cancelamento externo continua encerrando o turno.
   */
  loadGuestProfile?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<GuestProfileLoad>;
  /** Etapa 4: Documento Vivo (aprendizados aprovados do imóvel). Enriquecimento: falha não derruba o turno. */
  loadLivingDocument?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<LivingDocumentLoad>;
  /**
   * Pilar 1 (06/11/2026) — eventos da Home do guia para a cidade do imóvel (só leitura). Enriquecimento:
   * falha ⇒ bloco `indisponivel` (a IA admite não saber), nunca recusa o turno.
   */
  loadCityEvents?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<CityEventsLoad>;
  /**
   * B3.2 — fontes da pausa humana DERIVADA (mensagens gravadas + webhooks brutos + coluna). Pausa
   * ativa, indeterminada ou desconhecida (inclusive falha de leitura) ⇒ mesmo VETO da pausa da equipe.
   */
  loadHumanPause?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<HumanPauseSource>;
  /** B2.4 — estado do atendimento humano da conversa. Falha ⇒ erro técnico (fail-closed). */
  loadConversationOwnership?: (turn: ValidatedTurn, signal: AbortSignal) => Promise<ConversationOwnershipRow | null>;
  budget?: BudgetConfig;
  stageTimeoutMs?: number;
  /** Teto TOTAL do turno (padrão `TURN_MAX_DEADLINE_MS`, 15 s; o Copiloto pede até 30 s). */
  turnDeadlineMs?: number;
  /** B2.5 — cancelamento externo: aborta a etapa em curso e encerra em `stage_aborted` (sem texto). */
  signal?: AbortSignal;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  log?: (audit: ChainAudit) => void;
  /** Só para testes de fail-closed: substitui um validador por outro (inclusive um quebrado). */
  validators?: {
    structural?: typeof validateDecision;
    semantic?: typeof validateSemantics;
  };
}

export interface ChainInput {
  turn: ValidatedTurn;
  traceId: string;
  /** B2.5 — lote fechado de mensagens consecutivas do hóspede (emitido por `buildGuestMessageBatch`). */
  batch?: GuestMessageBatch | null;
  /** Copiloto (09/11/2026): sugestão obrigatória; `retryNote` = códigos do que barrou a tentativa anterior. */
  suggest?: { alwaysSuggest?: boolean; retryNote?: string } | null;
}

const TRACE = /^[\w.:-]{1,80}$/;
const PHASES: readonly StayPhase[] = ["inquiry", "pre_stay", "in_stay", "post_checkout", "cancelled", "no_show", "unknown"];
const CREDENTIAL_PHASES: readonly StayPhase[] = ["pre_stay", "in_stay"];

class StageTimeout extends Error {}
class StageAborted extends Error {}

/**
 * Integridade do contexto contra o TURNO validado (etapa 2). Pura. `null` = íntegro.
 * Qualquer ausência em campo obrigatório ou divergência de identidade/escopo ⇒ recusa.
 */
export function checkContextIntegrity(turn: ValidatedTurn, ctx: ConversationContext | null | undefined): ChainRefusalCode | null {
  if (!ctx || typeof ctx !== "object" || !ctx.guest || typeof ctx.guest !== "object") return "context_incomplete";
  const g = ctx.guest;
  if (!g.property || !g.interlocutor || !g.access || !ctx.credentialPolicy || !ctx.humanOwnership || !Array.isArray(g.audiences) || !Array.isArray(g.openCases)) {
    return "context_incomplete";
  }
  if (typeof turn.tenantId !== "string" || !turn.tenantId || typeof g.property.tenantId !== "string" || !g.property.tenantId) return "tenant_unknown";
  if (g.property.tenantId !== turn.tenantId) return "property_tenant_mismatch";
  if (typeof g.property.id !== "string" || !g.property.id || g.property.id !== turn.propertyId) return "property_identity_mismatch";
  if (g.interlocutor.conversationId !== turn.conversationId || g.interlocutor.messageId !== turn.messageId || g.interlocutor.surface !== turn.surface) {
    return "conversation_identity_mismatch";
  }
  // Reserva: se o contexto traz estadia, ela é a reserva vinculada À CONVERSA (nunca outra).
  if (g.stay && g.stay.reservationId !== turn.reservationId) return "reservation_conversation_mismatch";
  if (g.credentials !== null || g.access.credentialsAllowed !== false) return "credentials_present";
  if ((g.audiences as readonly string[]).includes("I")) return "internal_audience";
  if (!PHASES.includes(g.phase) || !(GUEST_SURFACES as readonly string[]).includes(g.interlocutor.surface)) return "context_incomplete";
  if (ctx.credentialPolicy.decision !== "allow" && ctx.credentialPolicy.decision !== "deny") return "context_incomplete";
  if (g.stay && g.stay.phase !== g.phase) return "context_inconsistent";
  if (ctx.humanOwnership.openCaseCount !== ctx.humanOwnership.cases.length) return "context_inconsistent";
  if (ctx.credentialPolicy.decision === "allow" && (!g.stay || !CREDENTIAL_PHASES.includes(g.phase))) return "credential_policy_inconsistent";
  return null;
}

/** Dossiês: escopo do turno e audiência (a composição revalida emissão, imóvel e tenant). Pura. */
export function checkDossierScope(turn: ValidatedTurn, d: ChainDossiers | null): ChainRefusalCode | null {
  if (d === null) return null;
  if (!d || typeof d !== "object" || !d.primary) return "dossier_out_of_scope";
  const all = [d.primary, ...(Array.isArray(d.candidates) ? d.candidates : [])];
  for (const x of all) {
    if (!x || !Array.isArray(x.audiences)) return "dossier_out_of_scope";
    if ((x.audiences as readonly string[]).some((a) => a !== "P" && a !== "G")) return "dossier_internal_audience";
    if (x.tenantId !== turn.tenantId) return "dossier_out_of_scope";
  }
  if (d.primary.propertyId !== turn.propertyId || d.primary.role !== "primary") return "dossier_out_of_scope";
  return null;
}

/** Histórico: disponível e da MESMA conversa/mensagem do turno validado. Pura. */
export function checkHistoryScope(turn: ValidatedTurn, history: HistoryResult | null | undefined): ChainRefusalCode | null {
  if (!history || history.status !== "available") return "history_unavailable";
  if (history.conversationId !== turn.conversationId || history.currentMessageId !== turn.messageId) return "history_scope_mismatch";
  return null;
}

const COMPOSE_REASON: Readonly<Record<ComposeUnavailableReason, { stage: ChainStageId; code: ChainRefusalCode }>> = Object.freeze({
  credentials_present: { stage: "context", code: "credentials_present" },
  free_text_guard_missing: { stage: "guard", code: "guard_missing" },
  guard_failed: { stage: "guard", code: "guard_failed" },
  guard_ambiguous: { stage: "guard", code: "guard_ambiguous" },
  guard_blocked: { stage: "guard", code: "guard_blocked" },
  history_unavailable: { stage: "history", code: "history_unavailable" },
  context_scope_mismatch: { stage: "history", code: "history_scope_mismatch" },
  surface_invalid: { stage: "context", code: "context_incomplete" },
  dossier_scope_mismatch: { stage: "dossier", code: "dossier_out_of_scope" },
  compose_failed: { stage: "compose", code: "compose_unavailable" },
});

function isReport(v: unknown): v is ValidationReport {
  if (!v || typeof v !== "object") return false;
  const r = v as ValidationReport;
  return (r.verdict === "pass" || r.verdict === "block") && Array.isArray(r.blocks) && (r.verdict === "pass") === (r.blocks.length === 0);
}
function isSemanticReport(v: unknown): v is SemanticReport {
  if (!isReport(v)) return false;
  const r = v as unknown as SemanticReport;
  return Array.isArray(r.unauthorizedKinds);
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
};

function situationOf(d: ModelDecision, ownership: CaseOwnership): ChainSituation {
  const sig = decisionSignals(d);
  const existing: ChainSituation["existingCase"] =
    ownership.openCaseCount === 0 ? "none" : (d.caseRelation === "no_open_case" ? "ambiguous" : (d.caseRelation as Exclude<ModelCaseRelation, "no_open_case">));
  return {
    humanAction: { needed: d.handoff.needed, urgency: d.handoff.urgency },
    existingCase: existing,
    emergency: sig.intents.includes("emergency"),
    intents: [...sig.intents],
  };
}

/**
 * B2.5 — o lote precisa ser o fim do histórico: todas as mensagens do lote presentes, do hóspede,
 * em ordem, e nenhuma mensagem de outro falante entre elas ou depois delas (nada já respondido).
 */
export function batchMatchesHistory(batch: GuestMessageBatch, history: HistoryResult): boolean {
  if (!history || history.status !== "available") return false;
  const entries = history.entries;
  const tail = entries.slice(entries.length - batch.size);
  if (tail.length !== batch.size) return false;
  return tail.every((e, i) => e.speaker === "guest" && e.messageId === batch.messages[i]!.id);
}

/** Horários oficiais LOCAIS (HH:MM, fuso IANA do imóvel) a partir da estadia validada. */
export function officialLocalTimes(ctx: ConversationContext): { officialCheckin: string | null; officialCheckout: string | null } {
  const tz = ctx.guest.property.timezone ?? ctx.guest.stay?.timezone ?? null;
  const local = (iso: string | null | undefined) => {
    if (!iso || !tz) return null;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
      const h = parts.find((p) => p.type === "hour")?.value;
      const m = parts.find((p) => p.type === "minute")?.value;
      return h && m ? `${h}:${m}` : null;
    } catch {
      return null;
    }
  };
  return { officialCheckin: local(ctx.guest.stay?.checkInAt), officialCheckout: local(ctx.guest.stay?.checkOutAt) };
}

export type PausedEvaluation =
  | { kind: "alert"; evidenceRefs: string[] }
  | { kind: "paused"; insufficientEvidence: boolean }
  | { kind: "refused"; code: "reply_during_pause" | "paused_decision_invalid" };

/**
 * B2.5 — decisão com a IA PAUSADA pela equipe (pura). A pausa é veto absoluto à resposta:
 *  - qualquer texto ao hóspede ⇒ `reply_during_pause` (recusa; nenhuma resposta);
 *  - emergência só vira alerta interno com encaminhamento URGENTE e evidência em mensagem do
 *    hóspede deste turno (ids `hist:guest:hN` do lote ou a mensagem atual); sem evidência ⇒ pausa;
 *  - reclamação/desconforto sem emergência ⇒ pausa (não é emergência);
 *  - a pergunta interna à equipe passa pelo guard (nenhum segredo).
 */
export function evaluatePausedDecision(
  d: ModelDecision,
  sourceIds: ReadonlySet<string> | null,
  batch: GuestMessageBatch | null,
  guard: Pick<FreeTextGuard, "scan"> | null,
): PausedEvaluation {
  if (d.reply.trim() !== "" || decisionSignals(d).shouldReply) return { kind: "refused", code: "reply_during_pause" };
  if (d.strategy !== "silence" && d.strategy !== "handoff") return { kind: "refused", code: "paused_decision_invalid" };
  if ((d.commitments ?? []).length > 0 || d.credentialIntent !== "none") return { kind: "refused", code: "paused_decision_invalid" };
  const emergency = decisionSignals(d).intents.includes("emergency");
  if (!emergency) return { kind: "paused", insufficientEvidence: false };
  if (!d.handoff.needed || d.handoff.urgency !== "high" || !d.handoff.question) return { kind: "paused", insufficientEvidence: true };
  try {
    const r = guard?.scan(d.handoff.question);
    if (!r || r.status !== "safe" || r.text !== d.handoff.question) return { kind: "refused", code: "paused_decision_invalid" };
  } catch {
    return { kind: "refused", code: "paused_decision_invalid" };
  }
  // Evidência: mensagens do hóspede deste turno (lote) citadas e existentes no prompt.
  const guestRefs = [...(sourceIds ?? [])].filter((id) => /^hist:guest:h\d+$/.test(id)).sort((a, b) => Number(a.split("h").pop()) - Number(b.split("h").pop()));
  const turnRefs = guestRefs.slice(guestRefs.length - (batch ? batch.size : 1));
  const evidence = d.groundedOn.filter((id) => turnRefs.includes(id));
  if (evidence.length === 0) return { kind: "paused", insufficientEvidence: true };
  return { kind: "alert", evidenceRefs: evidence };
}

/** Executa a cadeia. Nunca lança: toda falha vira `refused` ou `technical_error` (sem texto). */
export async function runTurnChain(input: ChainInput, deps: ChainDeps): Promise<ChainOutcome> {
  const rawNow = deps?.now ?? (() => Date.now());
  const now = () => {
    try {
      const v = rawNow();
      return typeof v === "number" && Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };
  const started = now();
  const schedule = deps?.schedule ?? defaultSchedule;
  const turnDeadline = Math.max(1, Math.min(TURN_DEADLINE_CEILING_MS, Math.floor(deps?.turnDeadlineMs ?? TURN_MAX_DEADLINE_MS)));
  const stageTimeout = Math.max(
    1,
    Math.min(Math.max(CHAIN_STAGE_TIMEOUT_MS * 3, turnDeadline), Math.floor(deps?.stageTimeoutMs ?? CHAIN_STAGE_TIMEOUT_MS)),
  );
  const traceId = typeof input?.traceId === "string" && TRACE.test(input.traceId) ? input.traceId : null;
  const completed: ChainStageId[] = [];
  let decisionVersion: DecisionContractVersion | null = null;
  let structuralBlocks: ValidationBlock[] = [];
  let semanticBlocks: SemanticBlock[] = [];
  const timings: Partial<Record<ChainTimingId, number>> = {};
  let interruption: ChainAudit["interruption"] = "none";
  let summary: ChainDecisionSummary | null = null;
  const checks: ChainSecurityChecks = {
    context: "not_run",
    dossierScope: "not_run",
    guard: null,
    credentialPolicy: null,
    stayAuthorizations: null,
    humanOwnership: null,
    sourceConflicts: 0,
    unknownFacts: 0,
    batch: null,
    senderIdentity: null,
    promisedTimes: [],
    text: null,
    pause: "not_evaluated",
    derivedPause: "not_evaluated",
    alert: "none",
  };
  const timeIt = <T>(id: ChainTimingId, fn: () => T): T => {
    const t0 = now();
    try {
      return fn();
    } finally {
      timings[id] = (timings[id] ?? 0) + Math.max(0, Math.round(now() - t0));
    }
  };
  const timeAsync = async <T>(id: ChainTimingId, fn: () => Promise<T>): Promise<T> => {
    const t0 = now();
    try {
      return await fn();
    } finally {
      timings[id] = (timings[id] ?? 0) + Math.max(0, Math.round(now() - t0));
    }
  };
  // FreeTextGuard cronometrado (mesma instância; só mede, não altera resultado).
  const rawGuard = deps?.guard ?? null;
  const timedGuard: FreeTextGuard | null =
    rawGuard && typeof rawGuard.scan === "function"
      ? { id: rawGuard.id, version: rawGuard.version, scan: (t, h) => timeIt("guard", () => rawGuard.scan(t, h)) }
      : null;
  const guardInfo = deps?.guard && typeof deps.guard.id === "string" && typeof deps.guard.version === "string" ? { id: deps.guard.id, version: deps.guard.version } : null;

  const audit = (kind: ChainOutcome["kind"], stage: ChainStageId, code: string | null): ChainAudit => ({
    event: "guest_ai.chain",
    chainVersion: TURN_CHAIN_VERSION,
    traceId,
    outcome: kind,
    stage,
    code,
    category: kind === "refused" ? "refusal" : kind,
    contractVersion: CURRENT_DECISION_VERSION,
    decisionVersion,
    parserVersion: DECISION_PARSER_VERSION,
    structuralValidatorVersion: STRUCTURAL_VALIDATOR_VERSION,
    semanticValidatorVersion: SEMANTIC_VALIDATOR_VERSION,
    composerVersion: COMPOSER_VERSION,
    guard: guardInfo,
    structuralBlocks: [...structuralBlocks],
    semanticBlocks: [...semanticBlocks],
    durationMs: Math.max(0, Math.round(now() - started)),
    stagesCompleted: [...completed],
    timings: { ...timings },
    interruption,
    decision: summary ? { ...summary, intents: [...summary.intents], unauthorizedKinds: [...summary.unauthorizedKinds], commitmentKinds: summary.commitmentKinds ? [...summary.commitmentKinds] : null, handoff: { ...summary.handoff } } : null,
    checks: {
      ...checks,
      guard: checks.guard ? { ...checks.guard } : null,
      stayAuthorizations: checks.stayAuthorizations ? { ...checks.stayAuthorizations } : null,
      batch: checks.batch ? { ...checks.batch } : null,
      senderIdentity: checks.senderIdentity ? { ...checks.senderIdentity } : null,
      promisedTimes: checks.promisedTimes.map((p) => ({ ...p })),
      text: checks.text ? { ...checks.text, detectedKinds: [...checks.text.detectedKinds], undeclaredKinds: [...checks.text.undeclaredKinds] } : null,
    },
  });
  const emit = <T extends ChainOutcome>(o: T): T => {
    try {
      deps?.log?.(o.audit);
    } catch {
      /* log nunca derruba a cadeia */
    }
    return o;
  };
  const NOT_SENT: NotSent = { delivery: "not_sent", effectsExecuted: false };
  const refuse = (stage: ChainStageId, code: ChainRefusalCode, situation: ChainSituation | null = null) =>
    emit({ kind: "refused", stage, code, situation, audit: audit("refused", stage, code), ...NOT_SENT });
  const technical = (stage: ChainStageId, code: ChainTechnicalCode) => emit({ kind: "technical_error", stage, code, audit: audit("technical_error", stage, code), ...NOT_SENT });

  const controller = new AbortController();
  const external = deps?.signal;
  /** Corrida contra o prazo da etapa; o sinal é abortado no estouro (a etapa deve parar). */
  const step = async <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (controller.signal.aborted || external?.aborted) throw new StageAborted();
    // Prazo da etapa limitado ao que resta do teto TOTAL do turno (15 s).
    const remaining = Math.floor(turnDeadline - (now() - started));
    if (remaining <= 0) {
      controller.abort("turn_deadline");
      throw new StageTimeout();
    }
    const limit = Math.min(stageTimeout, remaining);
    let cancel: () => void = () => {};
    let onAbort: (() => void) | null = null;
    try {
      return await Promise.race([
        Promise.resolve().then(() => fn(controller.signal)),
        new Promise<never>((_, reject) => {
          if (!external) return;
          onAbort = () => {
            controller.abort("cancelled");
            reject(new StageAborted());
          };
          external.addEventListener("abort", onAbort, { once: true });
        }),
        new Promise<never>((_, reject) => {
          cancel = schedule(() => {
            controller.abort("stage_timeout");
            reject(new StageTimeout());
          }, limit);
        }),
      ]);
    } finally {
      cancel();
      if (onAbort) external?.removeEventListener("abort", onAbort);
    }
  };
  const failure = (stage: ChainStageId, e: unknown) => {
    if (e instanceof StageTimeout) interruption = "timeout";
    else if (e instanceof StageAborted) interruption = "aborted";
    return technical(stage, e instanceof StageTimeout ? "stage_timeout" : e instanceof StageAborted ? "stage_aborted" : stage === "model_output" ? "model_call_failed" : "stage_failed");
  };

  try {
    // 1) Turno validado
    const turn = input?.turn;
    if (!isIssued("turn", turn)) return refuse("turn", "turn_not_validated");
    if (!traceId) return refuse("turn", "trace_invalid");
    // B2.5 — lote: emitido, do mesmo escopo do turno, e o turno é a mensagem MAIS RECENTE do lote
    // (mensagens do mesmo lote nunca geram decisões independentes).
    const batch = input.batch ?? null;
    if (batch !== null) {
      if (!isIssuedBatch(batch)) return refuse("turn", "batch_not_validated");
      if (batch.conversationId !== turn.conversationId || batch.propertyId !== turn.propertyId || batch.tenantId !== turn.tenantId) return refuse("turn", "batch_scope_mismatch");
      if (batch.latestMessageId !== turn.messageId) return refuse("turn", "batch_turn_mismatch");
      checks.batch = { batchId: batch.batchId, size: batch.size };
    }
    completed.push("turn");

    // 2) Contexto
    let ctx: ConversationContext;
    try {
      ctx = await timeAsync("context", () => step((s) => deps.loadContext(turn, s)));
    } catch (e) {
      return failure("context", e);
    }
    const ctxProblem = timeIt("scope_check", () => checkContextIntegrity(turn, ctx));
    checks.context = ctxProblem ?? "ok";
    if (ctxProblem) return refuse("context", ctxProblem);
    checks.credentialPolicy = ctx.credentialPolicy.decision;

    // B2.4 — atendimento humano por assunto (quando a fonte é fornecida; falha ⇒ fail-closed).
    let humanOwnership: HumanOwnershipSnapshot | null = null;
    if (deps.loadConversationOwnership) {
      let row: ConversationOwnershipRow | null;
      try {
        row = await timeAsync("human_ownership", () => step((s) => deps.loadConversationOwnership!(turn, s)));
      } catch (e) {
        return failure("context", e);
      }
      humanOwnership = deriveHumanOwnership(row && row.id === turn.conversationId ? row : null, new Date(now()).toISOString());
      checks.humanOwnership = humanOwnership.state;
      if (humanOwnership.state === "unknown" || humanOwnership.active !== ctx.humanOwnership.openCaseCount > 0) return refuse("context", "human_ownership_inconsistent");
      // B2.5 — pausa explícita da equipe: VETO ABSOLUTO à resposta ao hóspede. A cadeia segue só
      // para CLASSIFICAR uma possível emergência (alerta interno estruturado); nunca responde no chat.
      checks.pause = humanOwnership.aiPausedByTeam ? "active" : "inactive";
    }
    // B3.2 — pausa derivada do histórico: a condição mais restritiva prevalece; ilegível = pausada.
    let derivedPause: HumanPauseState | null = null;
    if (deps.loadHumanPause) {
      const nowIso = new Date(now()).toISOString();
      try {
        const src = await timeAsync("human_pause", () => step((s) => deps.loadHumanPause!(turn, s)));
        derivedPause = deriveHumanPause({ ...src, now: nowIso });
      } catch (e) {
        if (e instanceof StageTimeout || deps.signal?.aborted) return failure("context", e);
        derivedPause = deriveHumanPause({ lookup: "failed", column: null, persisted: [], persistedComplete: false, raw: [], rawComplete: false, allowedSourcePropertyIds: null, now: nowIso });
      }
      checks.derivedPause = derivedPause.state;
      if (batch && derivedPause.pausedUntil !== null) {
        const until = Date.parse(derivedPause.pausedUntil);
        // Decisão 7: nenhuma mensagem do lote pode ser da pausa (nem igual ao limite).
        if (batch.messages.some((m) => !(Date.parse(m.createdAt) > until))) return refuse("context", "batch_contains_paused_messages");
      }
    }
    const paused = humanOwnership?.aiPausedByTeam === true || (derivedPause !== null && derivedPause.state !== "active");
    if (derivedPause && derivedPause.state !== "active") checks.pause = "active";
    else if (derivedPause && checks.pause === "not_evaluated") checks.pause = "inactive";

    // B2.4 — autorizações formais de horário (fonte indisponível ⇒ nada autorizado).
    let stayAuthorizations: StayAuthorizations | null = null;
    if (deps.loadStayAuthorizationSource) {
      try {
        const src = await timeAsync("stay_authorizations", () => step((s) => deps.loadStayAuthorizationSource!(turn, s)));
        stayAuthorizations = evaluateStayAuthorizations({ ...src, lookup: "ok", turn: { propertyId: turn.propertyId, reservationId: turn.reservationId }, now: new Date(now()).toISOString() });
      } catch (e) {
        if (e instanceof StageTimeout) return failure("context", e);
        stayAuthorizations = unavailableStayAuthorizations();
      }
      checks.stayAuthorizations = {
        earlyCheckin: stayAuthorizations.earlyCheckin.reason,
        lateCheckout: stayAuthorizations.lateCheckout.status === "authorized" ? "authorized" : stayAuthorizations.lateCheckout.reason,
      };
    }
    // B2.5 — identidade de envio (determinística; nunca escolhida pelo modelo). Só leitura.
    let senderIdentity: SenderIdentity | null = null;
    if (deps.loadSenderIdentitySource) {
      let src: SenderIdentitySource;
      try {
        src = await timeAsync("sender_identity", () => step((s) => deps.loadSenderIdentitySource!(turn, s)));
      } catch (e) {
        if (e instanceof StageTimeout) return failure("context", e);
        src = { lookup: "failed", conversationListingId: null, reservationListingId: null, listings: [], twins: [], prefs: [], accounts: [] };
      }
      senderIdentity = resolveSenderIdentity({ tenantId: turn.tenantId, propertyId: turn.propertyId, surface: turn.surface, source: src, now: new Date(now()).toISOString() });
      checks.senderIdentity = { status: senderIdentity.status, source: senderIdentity.source, reason: senderIdentity.reason };
    }
    // Memória do hóspede (enriquecimento; nunca recusa o turno)
    let guestProfile: GuestProfileContext | null = null;
    if (deps.loadGuestProfile) {
      try {
        guestProfile = buildGuestProfileContext(await timeAsync("context", () => step((s) => deps.loadGuestProfile!(turn, s))));
      } catch (e) {
        if (deps.signal?.aborted) return failure("context", e);
        guestProfile = buildGuestProfileContext({ status: "unavailable" });
      }
    }
    // Eventos da cidade (enriquecimento; nunca recusa o turno)
    let cityEvents: CityEventsLoad | null = null;
    if (deps.loadCityEvents) {
      try {
        cityEvents = await timeAsync("context", () => step((s) => deps.loadCityEvents!(turn, s)));
      } catch (e) {
        if (deps.signal?.aborted) return failure("context", e);
        cityEvents = { status: "unavailable", reason: "lookup_failed" };
      }
    }
    // Documento Vivo (enriquecimento; nunca recusa o turno)
    let livingDocument: LivingDocumentLoad | null = null;
    if (deps.loadLivingDocument) {
      try {
        livingDocument = await timeAsync("context", () => step((s) => deps.loadLivingDocument!(turn, s)));
      } catch (e) {
        if (deps.signal?.aborted) return failure("context", e);
        livingDocument = { status: "unavailable", reason: "lookup_failed" };
      }
    }
    completed.push("context");

    // 3) Dossiê (opcional; quando há, é crítico)
    let dossiers: ChainDossiers | null = null;
    if (deps.loadDossiers) {
      try {
        dossiers = await timeAsync("dossier", () => step((s) => deps.loadDossiers!(turn, s)));
      } catch (e) {
        return failure("dossier", e);
      }
      const dProblem = timeIt("scope_check", () => checkDossierScope(turn, dossiers ?? null));
      checks.dossierScope = dProblem ?? (dossiers ? "ok" : "not_provided");
      if (dProblem) return refuse("dossier", dProblem);
      for (const d of dossiers ? [dossiers.primary, ...(dossiers.candidates ?? [])] : []) {
        const resolved = Array.isArray(d.resolved) ? d.resolved : [];
        checks.sourceConflicts += resolved.filter((r) => r.status === "conflict").length + (Array.isArray(d.conflicts) ? d.conflicts.length : 0);
        checks.unknownFacts += resolved.filter((r) => r.status === "unknown" || r.status === "stale").length + (Array.isArray(d.unknown) ? d.unknown.length : 0);
      }
    } else {
      checks.dossierScope = "not_provided";
    }
    completed.push("dossier");

    // 4) Histórico
    let history: HistoryResult;
    try {
      history = await timeAsync("history", () => step((s) => deps.loadHistory(turn, s)));
    } catch (e) {
      return failure("history", e);
    }
    const hProblem = checkHistoryScope(turn, history);
    if (hProblem) return refuse("history", hProblem);
    if (batch && !batchMatchesHistory(batch, history)) return refuse("history", "batch_history_mismatch");
    completed.push("history");

    // 5 + 6) Guard e composição (o composer aplica a política §6.1 a cada texto livre)
    if (!timedGuard) return refuse("guard", "guard_missing");
    const composeStart = now();
    const guardBefore = timings.guard ?? 0;
    const composed = composeTurnPrompt(
      { context: ctx, history, dossiers, batch, guestProfile, cityEvents, livingDocument, operational: { stayAuthorizations, humanOwnership, aiPausedByTeam: paused }, suggest: input.suggest ?? null },
      { guard: timedGuard, budget: deps.budget },
    );
    timings.compose = Math.max(0, Math.round(now() - composeStart) - ((timings.guard ?? 0) - guardBefore));
    if (composed.kind === "prompt") {
      const b = composed.guardMetrics.byStatus;
      checks.guard = { safe: b.safe, sanitized: b.sanitized, ambiguous: b.ambiguous, blocked: b.blocked };
    }
    if (composed.kind === "unavailable") {
      const m = COMPOSE_REASON[composed.reason] ?? { stage: "compose" as const, code: "compose_unavailable" as const };
      return refuse(m.stage, m.code);
    }
    completed.push("guard");
    if (composed.kind === "over_budget") return refuse("compose", "compose_over_budget");
    const prompt = composed.prompt;
    if (!prompt.sourceIds || prompt.sourceIds.size === 0) return refuse("compose", "grounding_unverifiable");
    completed.push("compose");

    // 7) Saída do modelo (gerador injetado; nunca o Gateway nesta fase)
    let raw: unknown;
    try {
      raw = await timeAsync("model_output", () => step((s) => deps.generate(prompt, s)));
    } catch (e) {
      return failure("model_output", e);
    }
    completed.push("model_output");

    // 8) Parser (contrato exigido = o que o prompt pediu)
    const parsed = timeIt("parse", () => parseDecisionText(raw, { expectVersion: CURRENT_DECISION_VERSION }));
    if (!parsed.ok) return refuse("parse", `parse_${parsed.error.code}`);
    decisionVersion = parsed.version;
    const decision = reconcileDecision(parsed.decision);
    const sig0 = decisionSignals(decision);
    summary = {
      shouldReply: sig0.shouldReply,
      strategy: decision.strategy,
      intents: [...sig0.intents],
      commitmentKinds: decision.commitmentKinds ? [...decision.commitmentKinds] : null,
      unauthorizedKinds: [],
      handoff: { needed: decision.handoff.needed, urgency: decision.handoff.urgency },
      caseRelation: decision.caseRelation,
      credentialIntent: decision.credentialIntent,
      milestone: sig0.hospitalityMilestone ? sig0.hospitalityMilestone.kind : null,
    };
    completed.push("parse");

    const ownership = resolveCaseOwnership(ctx.guest.openCases, decision.caseRelation);
    const situation = situationOf(decision, ownership);

    // B2.5 — IA pausada pela equipe: só `paused` ou `urgent_internal_alert`; NUNCA resposta ao hóspede.
    if (paused) {
      completed.push("final_decision");
      const p = evaluatePausedDecision(decision, prompt.sourceIds, batch, timedGuard);
      if (p.kind === "refused") return refuse("final_decision", p.code, situation);
      if (p.kind === "alert") {
        checks.alert = "raised";
        const alert: UrgentInternalAlert = Object.freeze({
          kind: "urgent_internal_alert",
          priority: "critical",
          conversationId: turn.conversationId,
          propertyId: turn.propertyId,
          tenantId: turn.tenantId,
          evidenceRefs: [...p.evidenceRefs],
          notified: false,
          delivery: "not_sent",
          effectsExecuted: false,
        });
        return emit({ kind: "urgent_internal_alert", alert, situation, audit: audit("urgent_internal_alert", "final_decision", null), ...NOT_SENT });
      }
      if (p.insufficientEvidence) checks.alert = "insufficient_evidence";
      return emit({ kind: "paused", situation, audit: audit("paused", "final_decision", null), ...NOT_SENT });
    }

    // 9) Validador estrutural
    let structural: unknown;
    try {
      structural = timeIt("structural_validation", () =>
        (deps.validators?.structural ?? validateDecision)({ decision, credentialPolicy: ctx.credentialPolicy.decision, ownership, sourceIds: prompt.sourceIds }),
      );
    } catch {
      return technical("structural_validation", "validator_exception");
    }
    if (!isReport(structural)) return refuse("structural_validation", "structural_validator_invalid", situation);
    structuralBlocks = [...structural.blocks];
    if (structural.verdict !== "pass") return refuse("structural_validation", "structural_block", situation);
    completed.push("structural_validation");

    // 10) Validador semântico
    const views: SemanticDossierView[] = composed.dossierRefs.map((r) => {
      const d = r.role === "primary" ? dossiers?.primary : (dossiers?.candidates ?? []).find((c) => c.propertyId === r.propertyId);
      return { ref: r.ref, role: r.role, availability: d ? d.availability.status : "not_consulted" };
    });
    let semantic: unknown;
    try {
      semantic = timeIt("semantic_validation", () =>
        (deps.validators?.semantic ?? validateSemantics)({
          decision,
          context: ctx,
          ownership,
          dossiers: views,
          priorMilestones: deps.priorMilestones ?? { status: "unknown" },
          guard: timedGuard,
          stayAuthorizations,
          humanOwnership,
          officialTimes: officialLocalTimes(ctx),
        }),
      );
    } catch {
      return technical("semantic_validation", "validator_exception");
    }
    if (!isSemanticReport(semantic)) return refuse("semantic_validation", "semantic_validator_invalid", situation);
    semanticBlocks = [...semantic.blocks];
    summary.unauthorizedKinds = [...semantic.unauthorizedKinds];
    checks.text = semantic.text ? { language: semantic.text.language, detectedKinds: [...semantic.text.detectedKinds], undeclaredKinds: [...semantic.text.undeclaredKinds] } : null;
    checks.promisedTimes = (decision.promisedTimes ?? []).map((pt) => {
      const a = pt.kind === "late_checkout" ? stayAuthorizations?.lateCheckout : stayAuthorizations?.earlyCheckin;
      const ok =
        pt.kind === "late_checkout" &&
        checkRequestedLateCheckout({
          requested: { date: pt.date, time: pt.time, timezone: pt.timezone },
          authorization: a,
          turn: { reservationId: ctx.guest.stay?.reservationId ?? null, propertyId: ctx.guest.property.id },
          propertyTimezone: ctx.guest.property.timezone,
          officialCheckoutAt: ctx.guest.stay?.checkOutAt ?? null,
        }).status === "within_authorized";
      return { kind: pt.kind, result: ok ? "valid" : "invalid_commitment_time", authorizationSource: a && a.status === "authorized" ? a.source : null };
    });
    if (semantic.verdict !== "pass") return refuse("semantic_validation", "semantic_block", situation);
    completed.push("semantic_validation");

    // 11) Decisão final — silêncio é resultado legítimo e NUNCA vira texto.
    completed.push("final_decision");
    timings.final_decision = 0;
    const sig = decisionSignals(decision);
    if (!sig.shouldReply) {
      if (decision.reply !== "" || decision.strategy !== "silence") return refuse("final_decision", "final_inconsistent", situation);
      return emit({ kind: "silence", decision, situation, audit: audit("silence", "final_decision", null), ...NOT_SENT });
    }
    if (decision.strategy === "handoff") {
      if (!decision.handoff.needed || !decision.handoff.question) return refuse("final_decision", "final_inconsistent", situation);
      return emit({ kind: "human_action", question: decision.handoff.question, decision, situation, audit: audit("human_action", "final_decision", null), ...NOT_SENT });
    }
    if (!decision.reply) return refuse("final_decision", "final_inconsistent", situation);
    const dispatch: DispatchPreparation = {
      senderIdentity,
      sendAuthorization: "not_granted",
      state: senderIdentity && senderIdentity.status === "resolved" ? "awaiting_send_authorization" : "blocked_sender_identity",
    };
    return emit({ kind: "reply", text: decision.reply, strategy: decision.strategy, decision, situation, dispatch, audit: audit("reply", "final_decision", null), ...NOT_SENT });
  } catch {
    const stage = CHAIN_STAGE_IDS[Math.min(completed.length, CHAIN_STAGE_IDS.length - 1)]!;
    return technical(stage, "stage_failed");
  }
}
