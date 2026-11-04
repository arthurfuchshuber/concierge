/**
 * F2-B · B3.3 — EXTRATOR / DESCARTADOR.
 *
 * Fronteira do texto: `narrowOutcome` recebe o `ChainOutcome` completo e devolve uma projeção NOVA,
 * montada campo a campo, só com enums, contagens, versões e tempos da auditoria (que já é lista
 * branca). Nunca lê `text`, `question`, `decision`, `alert.question` nem qualquer campo livre. O
 * extrator (`buildExecutionRecord`) recebe SÓ a projeção — o tipo não admite o outcome integral.
 * `validateExecutionRecord` confere cada campo contra o vocabulário/formato (espelho das CHECK do
 * banco) e congela o resultado; qualquer desvio ⇒ `null` (o registro não é gravado).
 */
import type { ChainOutcome } from "@/lib/guest-ai/turn-chain";
import type { LlmErrorCode } from "@/lib/guest-ai/llm/contracts";
import { LLM_ERROR_CODES } from "@/lib/guest-ai/llm/contracts";
import { isIntegrityCode } from "./breakers";
import {
  BUDGET_LIMIT_IDS,
  CHAIN_REFUSAL_CODES,
  SHADOW_ALLOWED_MODELS,
  SHADOW_BLOCK_CODES,
  SHADOW_CHANNELS,
  SHADOW_COMMITMENT_KINDS,
  SHADOW_CONTEXT_CHECKS,
  SHADOW_DECISIONS,
  SHADOW_EXECUTION_STATES,
  SHADOW_INTENTS,
  SHADOW_PAUSE_STATES,
  SHADOW_RECORD_KEYS,
  SHADOW_STRATEGIES,
  SHADOW_TECHNICAL_CODES,
  SHADOW_TIMING_IDS,
  SHADOW_URGENCIES,
  SHADOW_USAGE_SOURCES,
  SHADOW_VERSION,
  INTEGRITY_CODES,
  UUID_RE,
  VERSION_RE,
  type BudgetLimitId,
  type IntegrityCode,
  type ShadowBlockCode,
  type ShadowChannel,
  type ShadowContextCheck,
  type ShadowDecision,
  type ShadowExecutionRecord,
  type ShadowExecutionState,
  type ShadowModelId,
  type ShadowPauseState,
  type ShadowTechnicalCode,
  type ShadowTimings,
} from "./contracts";
import type { ChainRefusalCode } from "@/lib/guest-ai/turn-chain";
import type { CommitmentKind, HandoffUrgency, IntentCategory, Strategy } from "@/lib/guest-ai/orchestrator/contracts";

const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const nonNegInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** Projeção estreita: SEM nenhum campo de texto livre (o tipo não tem onde guardá-lo). */
export interface NarrowOutcome {
  readonly kind: ChainOutcome["kind"];
  readonly refusalCode: ChainRefusalCode | null;
  readonly technicalCode: (typeof SHADOW_TECHNICAL_CODES)[number] | null;
  readonly strategy: Strategy | null;
  readonly intents: readonly IntentCategory[];
  readonly commitmentKinds: readonly CommitmentKind[];
  readonly handoffNeeded: boolean;
  readonly handoffUrgency: HandoffUrgency | null;
  readonly contextCheck: ShadowContextCheck;
  readonly senderIntegrityCode: IntegrityCode | null;
  readonly timings: ShadowTimings;
  readonly interruption: "none" | "timeout" | "aborted";
  readonly composerVersion: string | null;
  readonly chainVersion: string | null;
}

/** Copia SÓ a auditoria por lista branca. Nunca acessa texto, pergunta ou decisão do modelo. */
export function narrowOutcome(outcome: ChainOutcome): NarrowOutcome {
  const kind = outcome.kind;
  const audit = outcome.audit;
  const d = audit?.decision ?? null;
  const code = kind === "refused" ? outcome.code : kind === "technical_error" ? outcome.code : null;
  const ctx = audit?.checks?.context;
  const sender = audit?.checks?.senderIdentity?.reason;
  const timings = {} as Record<(typeof SHADOW_TIMING_IDS)[number], number | null>;
  for (const id of SHADOW_TIMING_IDS) {
    const v = audit?.timings?.[id];
    timings[id] = nonNegInt(v) ? v : null;
  }
  return Object.freeze({
    kind,
    refusalCode: kind === "refused" && inList(CHAIN_REFUSAL_CODES, code) ? code : null,
    technicalCode: kind === "technical_error" && inList(SHADOW_TECHNICAL_CODES, code) ? code : null,
    strategy: d && inList(SHADOW_STRATEGIES, d.strategy) ? d.strategy : null,
    intents: d && Array.isArray(d.intents) ? Object.freeze(d.intents.filter((i) => inList(SHADOW_INTENTS, i))) : Object.freeze([]),
    commitmentKinds: d && Array.isArray(d.commitmentKinds) ? Object.freeze(d.commitmentKinds.filter((k): k is CommitmentKind => inList(SHADOW_COMMITMENT_KINDS, k))) : Object.freeze([]),
    handoffNeeded: d?.handoff?.needed === true,
    handoffUrgency: d && inList(SHADOW_URGENCIES, d.handoff?.urgency) ? d.handoff.urgency : null,
    contextCheck: ctx === "ok" ? "ok" : ctx === "not_run" || ctx === undefined ? "not_run" : "refused",
    senderIntegrityCode: isIntegrityCode(sender) ? sender : null,
    timings: Object.freeze(timings),
    interruption: audit?.interruption === "timeout" || audit?.interruption === "aborted" ? audit.interruption : "none",
    composerVersion: typeof audit?.composerVersion === "string" && VERSION_RE.test(audit.composerVersion) ? audit.composerVersion : null,
    chainVersion: typeof audit?.chainVersion === "string" && VERSION_RE.test(audit.chainVersion) ? audit.chainVersion : null,
  });
}

const INSUFFICIENT: readonly ChainRefusalCode[] = ["context_incomplete", "history_unavailable", "grounding_unverifiable", "compose_unavailable", "compose_over_budget"];

/** Decisão Shadow a partir da projeção (tabela §6.1 do desenho). */
export function classifyNarrow(n: NarrowOutcome): ShadowDecision {
  if (n.senderIntegrityCode) return "integrity_violation";
  switch (n.kind) {
    case "reply":
      return "answer_candidate";
    case "silence":
      return "silence";
    case "human_action":
      return "human_intervention";
    case "paused":
      return "human_pause_active";
    case "urgent_internal_alert":
      return "urgent_internal_alert";
    case "technical_error":
      return "technical_failure";
    default:
      if (n.refusalCode && isIntegrityCode(n.refusalCode)) return "integrity_violation";
      if (n.refusalCode && INSUFFICIENT.includes(n.refusalCode)) return "insufficient_context";
      return "operational_restriction";
  }
}

/** Metadados do worker (todos tipados; nenhum texto). */
export interface ExecutionMeta {
  executionId: string;
  tenantId: string;
  propertyId: string;
  conversationId: string;
  channel: ShadowChannel;
  batchId: string | null;
  leaseVersion: number | null;
  modelId: ShadowModelId | null;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  leaseMs: number;
  contextMs: number;
  gatewayMs: number;
  validationMs: number;
  gateway: { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number; usageSource: (typeof SHADOW_USAGE_SOURCES)[number]; costUsd: number; error: LlmErrorCode | null };
  estimatedInputTokens: number | null;
  pauseState: ShadowPauseState;
  executionState: ShadowExecutionState;
  technicalCode: ShadowTechnicalCode | null;
  blockCode: ShadowBlockCode | null;
  integrityCode: IntegrityCode | null;
  budgetExceeded: BudgetLimitId | null;
  tokenLimitViolation: boolean;
  concurrencyDetected: boolean;
  /** Decisão imposta pelo worker (bloqueio/timeout/desligamento) — prevalece sobre a da cadeia. */
  forcedDecision: ShadowDecision | null;
}

export const EMPTY_TIMINGS: ShadowTimings = Object.freeze(Object.fromEntries(SHADOW_TIMING_IDS.map((k) => [k, null])) as ShadowTimings);
export const NO_GATEWAY: ExecutionMeta["gateway"] = Object.freeze({ calls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, usageSource: "none", costUsd: 0, error: null });

/** Monta o registro a partir da projeção (ou `null`, quando a cadeia nem rodou). */
export function buildExecutionRecord(narrow: NarrowOutcome | null, meta: ExecutionMeta, chainVersionFallback: string): ShadowExecutionRecord {
  const decision: ShadowDecision = meta.forcedDecision ?? (meta.integrityCode ? "integrity_violation" : narrow ? classifyNarrow(narrow) : "technical_failure");
  const integrity: IntegrityCode | null = meta.integrityCode ?? narrow?.senderIntegrityCode ?? (narrow?.refusalCode && isIntegrityCode(narrow.refusalCode) ? narrow.refusalCode : null);
  const technical: ShadowTechnicalCode | null = meta.technicalCode ?? narrow?.technicalCode ?? (meta.gateway.error ? "gateway_error" : null);
  return {
    executionId: meta.executionId,
    tenantId: meta.tenantId,
    propertyId: meta.propertyId,
    conversationId: meta.conversationId,
    batchId: meta.batchId,
    leaseVersion: meta.leaseVersion,
    channel: meta.channel,
    chainVersion: narrow?.chainVersion ?? chainVersionFallback,
    shadowVersion: SHADOW_VERSION,
    composerVersion: narrow?.composerVersion ?? null,
    modelId: meta.modelId,
    startedAt: meta.startedAt,
    finishedAt: meta.finishedAt,
    totalMs: meta.totalMs,
    leaseMs: meta.leaseMs,
    contextMs: meta.contextMs,
    gatewayMs: meta.gatewayMs,
    validationMs: meta.validationMs,
    timings: narrow?.timings ?? EMPTY_TIMINGS,
    inputTokens: meta.gateway.inputTokens,
    outputTokens: meta.gateway.outputTokens,
    reasoningTokens: meta.gateway.reasoningTokens,
    totalTokens: meta.gateway.totalTokens,
    usageSource: meta.gateway.usageSource,
    costUsd: meta.gateway.costUsd,
    gatewayCalls: meta.gateway.calls,
    estimatedInputTokens: meta.estimatedInputTokens,
    candidateAvailable: decision === "answer_candidate",
    decision,
    strategy: narrow?.strategy ?? null,
    intents: narrow?.intents ?? [],
    intentCount: narrow?.intents.length ?? 0,
    commitmentKinds: narrow?.commitmentKinds ?? [],
    humanInterventionNeeded: decision === "human_intervention" || narrow?.handoffNeeded === true,
    handoffUrgency: narrow?.handoffUrgency ?? null,
    pauseState: meta.pauseState,
    contextCheck: narrow?.contextCheck ?? "not_run",
    executionState: meta.executionState,
    responseDiscarded: true,
    timeout: meta.executionState === "timed_out" || narrow?.interruption === "timeout",
    tokenLimitViolation: meta.tokenLimitViolation,
    concurrencyDetected: meta.concurrencyDetected,
    gatewayError: meta.gateway.error,
    budgetExceeded: meta.budgetExceeded,
    refusalCode: narrow?.refusalCode ?? null,
    technicalCode: technical,
    blockCode: meta.blockCode,
    integrityCode: integrity,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const nullOr = <T>(v: T | null, ok: (x: T) => boolean) => v === null || ok(v);

/**
 * Validação de valor (espelho das CHECK do banco). Rejeita chave a mais/a menos, texto fora de
 * vocabulário, UUID/versão fora do formato e números inválidos. Devolve cópia congelada ou `null`.
 */
export function validateExecutionRecord(r: unknown): Readonly<ShadowExecutionRecord> | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const o = r as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  if (keys.length !== SHADOW_RECORD_KEYS.length || keys.some((k, i) => k !== [...SHADOW_RECORD_KEYS].sort()[i])) return null;
  const x = o as unknown as ShadowExecutionRecord;
  const uuid = (v: unknown) => typeof v === "string" && UUID_RE.test(v);
  const t = x.timings as unknown;
  const timingsOk =
    !!t && typeof t === "object" && !Array.isArray(t) &&
    Object.keys(t).length === SHADOW_TIMING_IDS.length &&
    SHADOW_TIMING_IDS.every((k) => { const v = (t as Record<string, unknown>)[k]; return v === null || nonNegInt(v); });
  const ok =
    uuid(x.executionId) && uuid(x.tenantId) && uuid(x.propertyId) && uuid(x.conversationId) &&
    nullOr(x.batchId, uuid) && nullOr(x.leaseVersion, nonNegInt) &&
    inList(SHADOW_CHANNELS, x.channel) &&
    typeof x.chainVersion === "string" && VERSION_RE.test(x.chainVersion) &&
    x.shadowVersion === SHADOW_VERSION &&
    nullOr(x.composerVersion, (v) => typeof v === "string" && VERSION_RE.test(v)) &&
    nullOr(x.modelId, (v) => inList(SHADOW_ALLOWED_MODELS, v)) &&
    typeof x.startedAt === "string" && ISO.test(x.startedAt) && typeof x.finishedAt === "string" && ISO.test(x.finishedAt) &&
    [x.totalMs, x.leaseMs, x.contextMs, x.gatewayMs, x.validationMs, x.inputTokens, x.outputTokens, x.reasoningTokens, x.totalTokens, x.gatewayCalls, x.intentCount].every(nonNegInt) &&
    x.gatewayCalls <= 2 &&
    timingsOk &&
    inList(SHADOW_USAGE_SOURCES, x.usageSource) &&
    typeof x.costUsd === "number" && Number.isFinite(x.costUsd) && x.costUsd >= 0 &&
    nullOr(x.estimatedInputTokens, nonNegInt) &&
    typeof x.candidateAvailable === "boolean" && x.candidateAvailable === (x.decision === "answer_candidate") &&
    inList(SHADOW_DECISIONS, x.decision) &&
    nullOr(x.strategy, (v) => inList(SHADOW_STRATEGIES, v)) &&
    Array.isArray(x.intents) && x.intents.every((i) => inList(SHADOW_INTENTS, i)) && x.intentCount === x.intents.length &&
    Array.isArray(x.commitmentKinds) && x.commitmentKinds.every((k) => inList(SHADOW_COMMITMENT_KINDS, k)) &&
    typeof x.humanInterventionNeeded === "boolean" &&
    nullOr(x.handoffUrgency, (v) => inList(SHADOW_URGENCIES, v)) &&
    inList(SHADOW_PAUSE_STATES, x.pauseState) &&
    inList(SHADOW_CONTEXT_CHECKS, x.contextCheck) &&
    inList(SHADOW_EXECUTION_STATES, x.executionState) &&
    x.responseDiscarded === true &&
    typeof x.timeout === "boolean" && typeof x.tokenLimitViolation === "boolean" && typeof x.concurrencyDetected === "boolean" &&
    nullOr(x.gatewayError, (v) => inList(LLM_ERROR_CODES, v)) &&
    nullOr(x.budgetExceeded, (v) => inList(BUDGET_LIMIT_IDS, v)) &&
    nullOr(x.refusalCode, (v) => inList(CHAIN_REFUSAL_CODES, v)) &&
    nullOr(x.technicalCode, (v) => inList(SHADOW_TECHNICAL_CODES, v)) &&
    nullOr(x.blockCode, (v) => inList(SHADOW_BLOCK_CODES, v)) &&
    nullOr(x.integrityCode, (v) => inList(INTEGRITY_CODES, v)) &&
    (x.decision !== "integrity_violation" || x.integrityCode !== null) &&
    (x.decision !== "technical_failure" || x.technicalCode !== null);
  if (!ok) return null;
  return Object.freeze({ ...x, timings: Object.freeze({ ...x.timings }), intents: Object.freeze([...x.intents]), commitmentKinds: Object.freeze([...x.commitmentKinds]) });
}
