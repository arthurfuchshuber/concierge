/**
 * F2-B · B3.3 — CONTRATOS DO SHADOW MODE COM GATEWAY REAL (Entrega 2).
 *
 * Vocabulários FECHADOS, espelhados um a um nas CHECK constraints da migration
 * `supabase/migrations/20261104120000_guest_ai_shadow.sql` (o teste `b33-contracts` confere a igualdade).
 * Nenhum tipo deste arquivo admite texto livre: o `ShadowExecutionRecord` só tem uniões literais,
 * números, booleanos, UUIDs e versões (formato validado) — nunca resposta, pergunta, prompt, histórico,
 * contexto, mensagem de erro ou JSON do modelo.
 *
 * Arquivo puro: só tipos/constantes; não importa banco, rede, canais nem o slot.
 */
import type { ChainRefusalCode, ChainStageId, ChainTechnicalCode, ChainTimingId } from "@/lib/guest-ai/turn-chain";
import type { CommitmentKind, HandoffUrgency, IntentCategory, Strategy } from "@/lib/guest-ai/orchestrator/contracts";
import type { LlmErrorCode } from "@/lib/guest-ai/llm/contracts";

export const SHADOW_VERSION = "shadow-exec.2026-11-04.1";

// ─────────────────────────── Estado global (§8 do desenho) ───────────────────────────

export const SHADOW_STATES = ["disabled", "ready", "running", "paused", "circuit_open", "budget_exhausted", "integrity_violation", "technical_failure"] as const;
export type ShadowState = (typeof SHADOW_STATES)[number];
/**
 * Estados de falha: só saem por autorização explícita (nunca automaticamente). Decisão A1: `budget_exhausted`
 * NÃO é mais causado por cota diária esgotada (a reserva é recusada, sem desarme); só por anomalia grave —
 * uso real acima do reservado (`token_limit_violation`).
 */
export const SHADOW_FAILURE_STATES = ["circuit_open", "budget_exhausted", "integrity_violation", "technical_failure"] as const satisfies readonly ShadowState[];
export type ShadowFailureState = (typeof SHADOW_FAILURE_STATES)[number];

/** Motivos de transição (registrados em `guest_ai_shadow_transitions`). */
export const SHADOW_TRANSITION_REASONS = [
  "initial",
  "authorized_activation",
  "authorized_pause",
  "authorized_resume",
  "authorized_disable",
  "authorized_recovery",
  "error_rate_exceeded",
  "consecutive_failures",
  // A1: não existe motivo de desarme por cota diária (`budget_limit_reached` foi removido)
  "token_limit_violation",
  "integrity_divergence",
  "measurement_unavailable",
  "telemetry_failure",
  "config_invalid",
] as const;
export type ShadowTransitionReason = (typeof SHADOW_TRANSITION_REASONS)[number];

// ─────────────────────────── Decisões (§6.1) e execução ───────────────────────────

export const SHADOW_DECISIONS = [
  "answer_candidate",
  "silence",
  "human_intervention",
  "human_pause_active",
  "urgent_internal_alert",
  "insufficient_context",
  "operational_restriction",
  "integrity_violation",
  "technical_failure",
  "budget_blocked",
  "blocked_not_authorized",
  "aborted_by_shutdown",
] as const;
export type ShadowDecision = (typeof SHADOW_DECISIONS)[number];

/** Decisões que NÃO testam a técnica: ficam fora do denominador da taxa de erro (§7.3). */
export const NON_EVALUABLE_DECISIONS = ["human_pause_active", "budget_blocked", "blocked_not_authorized", "aborted_by_shutdown"] as const satisfies readonly ShadowDecision[];

export const SHADOW_EXECUTION_STATES = ["completed", "blocked", "failed", "timed_out", "aborted"] as const;
export type ShadowExecutionState = (typeof SHADOW_EXECUTION_STATES)[number];

export const SHADOW_CHANNELS = ["airbnb", "whatsapp", "web"] as const;
export type ShadowChannel = (typeof SHADOW_CHANNELS)[number];

/**
 * Modelos permitidos no Shadow: SÓ OpenAI via `/responses` (`store: false`), conforme a decisão da
 * Entrega 1. Google e outros transportes ficam FORA até comprovação específica de retenção (§7.2 da
 * diretriz da Entrega 2). Não existe fallback para outro provedor.
 */
export const SHADOW_ALLOWED_MODELS = ["openai/gpt-6-astra", "openai/gpt-5.6-sol"] as const;
export type ShadowModelId = (typeof SHADOW_ALLOWED_MODELS)[number];
export const SHADOW_REASONING_EFFORTS = ["none", "low", "medium", "high"] as const;
export type ShadowReasoningEffort = (typeof SHADOW_REASONING_EFFORTS)[number];
/** Escopos de autorização de retenção (independentes do modelo escolhido). */
export const RETENTION_SCOPES = ["openai_responses"] as const;
export type RetentionScope = (typeof RETENTION_SCOPES)[number];

export const SHADOW_PAUSE_STATES = ["not_evaluated", "active", "inactive", "indefinite", "unknown"] as const;
export type ShadowPauseState = (typeof SHADOW_PAUSE_STATES)[number];
export const SHADOW_CONTEXT_CHECKS = ["not_run", "ok", "refused"] as const;
export type ShadowContextCheck = (typeof SHADOW_CONTEXT_CHECKS)[number];
export const SHADOW_USAGE_SOURCES = ["provider", "estimated", "none"] as const;

// ─────────────────────────── Códigos fechados ───────────────────────────

/** Barreiras do próprio Shadow (antes ou em volta da cadeia). */
export const SHADOW_BLOCK_CODES = [
  "master_switch_off",
  "not_released",
  "state_not_running",
  "state_unreadable",
  // E4 global: imóvel fora do escopo / inelegível / desligado (a porta do banco decide)
  "scope_off",
  "property_ineligible",
  "property_disabled",
  "tenant_disabled",
  "retention_not_authorized",
  "limits_missing",
  "limits_invalid",
  "model_not_allowed",
  "generator_not_issued",
  "budget_turn_exceeded",
  "budget_daily_exceeded",
  "budget_reservation_failed",
  "deadline_expired",
  "pause_active",
  "pause_indefinite",
  "pause_unreadable",
  "ownership_indeterminate",
  "ownership_unreadable",
  "shutdown_requested",
] as const;
export type ShadowBlockCode = (typeof SHADOW_BLOCK_CODES)[number];

export const BUDGET_LIMIT_IDS = ["turn_input_tokens", "turn_output_tokens", "turn_total_tokens", "turn_cost", "daily_cost", "daily_tokens", "daily_calls"] as const;
export type BudgetLimitId = (typeof BUDGET_LIMIT_IDS)[number];

/** TODOS os `ChainRefusalCode` (o compilador confere nos dois sentidos, logo abaixo). */
export const CHAIN_REFUSAL_CODES = [
  "turn_not_validated",
  "trace_invalid",
  "context_incomplete",
  "tenant_unknown",
  "property_tenant_mismatch",
  "property_identity_mismatch",
  "conversation_identity_mismatch",
  "reservation_conversation_mismatch",
  "credentials_present",
  "internal_audience",
  "context_inconsistent",
  "credential_policy_inconsistent",
  "ai_paused_by_team",
  "human_ownership_inconsistent",
  "batch_not_validated",
  "batch_scope_mismatch",
  "batch_turn_mismatch",
  "batch_history_mismatch",
  "batch_contains_paused_messages",
  "reply_during_pause",
  "paused_decision_invalid",
  "dossier_out_of_scope",
  "dossier_internal_audience",
  "history_unavailable",
  "history_scope_mismatch",
  "guard_missing",
  "guard_failed",
  "guard_ambiguous",
  "guard_blocked",
  "compose_unavailable",
  "compose_over_budget",
  "grounding_unverifiable",
  "parse_not_text",
  "parse_empty_output",
  "parse_output_too_large",
  "parse_malformed_json",
  "parse_truncated_json",
  "parse_not_object",
  "parse_scope_field_forbidden",
  "parse_unexpected_field",
  "parse_missing_field",
  "parse_mixed_version",
  "parse_version_mismatch",
  "parse_invalid_strategy",
  "parse_invalid_reply",
  "parse_invalid_handoff",
  "parse_invalid_case_relation",
  "parse_invalid_credential_intent",
  "parse_invalid_list",
  "parse_invalid_capability",
  "parse_invalid_signals",
  "parse_invalid_commitment_kinds",
  "parse_invalid_promised_times",
  "structural_block",
  "structural_validator_invalid",
  "semantic_block",
  "semantic_validator_invalid",
  "final_inconsistent",
] as const satisfies readonly ChainRefusalCode[];
type _RefusalsExhaustive = Exclude<ChainRefusalCode, (typeof CHAIN_REFUSAL_CODES)[number]> extends never ? true : never;
const _refusalsExhaustive: _RefusalsExhaustive = true;
void _refusalsExhaustive;

export const CHAIN_TECHNICAL_CODES = ["stage_timeout", "stage_aborted", "stage_failed", "model_call_failed", "validator_exception"] as const satisfies readonly ChainTechnicalCode[];
type _TechExhaustive = Exclude<ChainTechnicalCode, (typeof CHAIN_TECHNICAL_CODES)[number]> extends never ? true : never;
const _techExhaustive: _TechExhaustive = true;
void _techExhaustive;

/** Falhas técnicas próprias do Shadow (contam no disjuntor de erro, §7.3). */
export const SHADOW_TECHNICAL_CODES = [
  ...CHAIN_TECHNICAL_CODES,
  "gateway_error",
  "shadow_timeout",
  "postprocess_failed",
  "telemetry_failed",
  "lease_integrity_failure",
  "finalization_failed",
  "measurement_unavailable",
  "read_failed",
  // E3.1 (F-01/F-04): execução cujo worker se perdeu, encerrada pela reconciliação do banco
  "worker_lost",
] as const;
export type ShadowTechnicalCode = (typeof SHADOW_TECHNICAL_CODES)[number];

/** Sinais de divergência de tenant/imóvel/conversa/canal/identidade (§7.4) — disparam bloqueio GLOBAL. */
export const INTEGRITY_CODES = [
  // escopo (ScopeErrorCode)
  "tenant_mismatch",
  "property_unresolved",
  "surface_mismatch",
  "message_conversation_mismatch",
  // candidata (tenant/imóvel escolhidos pelo banco) × turno / lease / posse humana
  "candidate_tenant_mismatch",
  "candidate_property_mismatch",
  "lease_conversation_mismatch",
  "ownership_tenant_mismatch",
  "ownership_property_mismatch",
  "ownership_identity_inconsistent",
  // cadeia
  "tenant_unknown",
  "property_tenant_mismatch",
  "property_identity_mismatch",
  "conversation_identity_mismatch",
  "reservation_conversation_mismatch",
  "dossier_out_of_scope",
  "history_scope_mismatch",
  "batch_scope_mismatch",
  // identidade de envio
  "listing_other_tenant",
  "listing_property_mismatch",
  "twin_inconsistent",
  "preference_other_tenant",
  "channel_other_tenant",
  // lote
  "cross_tenant",
  "cross_property",
  "cross_conversation",
  "cross_channel",
] as const;
export type IntegrityCode = (typeof INTEGRITY_CODES)[number];

export const SHADOW_INTENTS = ["acknowledgment", "informational_query", "operational_request", "problem_report", "emergency", "formal_change_request", "arrival_confirmation", "departure_confirmation", "other"] as const satisfies readonly IntentCategory[];
type _IntentsExhaustive = Exclude<IntentCategory, (typeof SHADOW_INTENTS)[number]> extends never ? true : never;
const _intentsExhaustive: _IntentsExhaustive = true;
void _intentsExhaustive;

export const SHADOW_COMMITMENT_KINDS = ["reservation_change", "early_checkin", "late_checkout", "availability", "service_or_benefit", "credential_release", "action_completed", "resolution", "team_relay", "information_followup"] as const satisfies readonly CommitmentKind[];
type _KindsExhaustive = Exclude<CommitmentKind, (typeof SHADOW_COMMITMENT_KINDS)[number]> extends never ? true : never;
const _kindsExhaustive: _KindsExhaustive = true;
void _kindsExhaustive;

export const SHADOW_STRATEGIES = ["answer", "clarify", "guide", "suggest_alternatives", "handoff", "answer_and_handoff", "silence"] as const satisfies readonly Strategy[];
export const SHADOW_URGENCIES = ["low", "normal", "high"] as const satisfies readonly HandoffUrgency[];

export const SHADOW_TIMING_IDS = ["context", "dossier", "history", "scope_check", "stay_authorizations", "human_ownership", "human_pause", "sender_identity", "guard", "compose", "model_output", "parse", "structural_validation", "semantic_validation", "final_decision"] as const satisfies readonly ChainTimingId[];
type _TimingExhaustive = Exclude<ChainTimingId, (typeof SHADOW_TIMING_IDS)[number]> extends never ? true : never;
const _timingExhaustive: _TimingExhaustive = true;
void _timingExhaustive;

export const SHADOW_STAGE_IDS = ["turn", "context", "dossier", "history", "guard", "compose", "model_output", "parse", "structural_validation", "semantic_validation", "final_decision"] as const satisfies readonly ChainStageId[];

// ─────────────────────────── Formatos ───────────────────────────

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Versões de componentes: minúsculas, dígitos, ponto e hífen (ex.: `chain.2026-11-03.3`). */
export const VERSION_RE = /^[a-z0-9][a-z0-9.-]{0,47}$/;
/** Referência de evidência/investigação: SHA-256 hex (do documento ou commit de correção). */
export const EVIDENCE_REF_RE = /^[0-9a-f]{64}$/;
export const IANA_ZONE_RE = /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){0,2}$/;

// ─────────────────────────── Prazo (aprovado na diretriz da Entrega 2) ───────────────────────────

export const SHADOW_DEADLINE_MS = 15_000;
export const SHADOW_FINALIZATION_RESERVE_MS = 1_500;
export const SHADOW_PROCESSING_BUDGET_MS = SHADOW_DEADLINE_MS - SHADOW_FINALIZATION_RESERVE_MS;

// ─────────────────────────── Configuração (linha única de controle) ───────────────────────────

/** Teto diário APROVADO (US$ 1,00). A migration impõe o mesmo teto por CHECK. */
export const APPROVED_DAILY_COST_CEILING_USD = 1;
/** Tentativas máximas do Gateway (F2-A `MAX_ATTEMPTS`): o orçamento reserva o pior caso. */
export const GATEWAY_WORST_CASE_ATTEMPTS = 2;
/**
 * Parâmetros HOMOLOGADOS na Entrega 3.1 (PARTE III), impostos como TETOS — não são autorização de
 * ativação. A migration impõe os mesmos valores por CHECK; `validateShadowControl` recusa o resto.
 */
export const APPROVED_MAX_TURN_COST_USD = 0.15;
export const APPROVED_MAX_CONVERSATIONS_PER_TICK = 3;
export const APPROVED_TICK_INTERVAL_SECONDS = 60;
export const APPROVED_ERROR_MIN_SAMPLE = 20;
/** Decisão A1: o dia de orçamento é o dia UTC (a cota renova à 0h UTC). A migration impõe o mesmo valor por CHECK. */
export const APPROVED_BUDGET_TIMEZONE = "UTC";

/**
 * Configuração lida da linha única `guest_ai_shadow_control`. TODOS os limites pendentes de aprovação
 * nascem nulos: valor ausente/inválido ⇒ bloqueio (o estado não pode ir para `ready`).
 */
export interface ShadowControl {
  state: ShadowState;
  stateVersion: number;
  modelId: ShadowModelId | null;
  reasoningEffort: ShadowReasoningEffort | null;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxTotalTokens: number | null;
  maxTurnCostUsd: number | null;
  dailyCostLimitUsd: number | null;
  maxDailyTokens: number | null;
  maxDailyCalls: number | null;
  errorWindowMinutes: number | null;
  errorMinSample: number | null;
  budgetDayTimezone: string | null;
  telemetryRetentionDays: number | null;
  tickIntervalSeconds: number | null;
  maxConversationsPerTick: number | null;
  /** E4 global: escopo de imóveis (`none` ⇒ nenhum imóvel participa; `all_eligible` ⇒ todos os elegíveis). */
  propertyScope: PropertyScope;
  /** Autorização de retenção (independente do modelo); ausente ⇒ nenhuma chamada real. */
  retentionAuthorized: boolean;
  retentionScope: RetentionScope | null;
  /** E3.1 (F-09/F-03): instante do BANCO no momento da leitura (ms epoch); ausente ⇒ ilegível. */
  dbNowMs: number;
}

/** Configuração COMPLETA e válida (só existe depois de `validateShadowControl` aprovar). */
export interface ShadowLimits {
  modelId: ShadowModelId;
  reasoningEffort: ShadowReasoningEffort;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  maxTurnCostUsd: number;
  dailyCostLimitUsd: number;
  maxDailyTokens: number;
  maxDailyCalls: number;
  errorWindowMinutes: number;
  errorMinSample: number;
  budgetDayTimezone: string;
  telemetryRetentionDays: number;
  tickIntervalSeconds: number;
  maxConversationsPerTick: number;
  /** E3.1: tetos monetários em unidades exatas de 1e-8 US$ (`money.ts`). */
  maxTurnCostUsd8: bigint;
  dailyCostLimitUsd8: bigint;
}

// ─────────────────────────── Escopo global e elegibilidade (E4 global) ───────────────────────────

/** Escopo de imóveis do controle global (`guest_ai_shadow_control.property_scope`). */
export const PROPERTY_SCOPES = ["none", "all_eligible"] as const;
export type PropertyScope = (typeof PROPERTY_SCOPES)[number];

/** Motivos de INELEGIBILIDADE técnica (`guest_ai_shadow_eligibility_reason`, regra eligibility.2026-11-05.1). */
export const ELIGIBILITY_REASONS = ["property_not_found", "archived", "tenant_unresolved", "listing_inconsistent", "no_guest_channel", "operational_data_missing"] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/** Motivos fechados da porta de imóvel (`guest_ai_shadow_property_gate`): escopo, dono, interruptores e elegibilidade. */
export const PROPERTY_GATE_REASONS = ["scope_off", "tenant_mismatch", "tenant_disabled", "property_disabled", ...ELIGIBILITY_REASONS] as const;
export type PropertyGateReason = (typeof PROPERTY_GATE_REASONS)[number];

/** Código de bloqueio do REGISTRO correspondente a cada motivo da porta (o registro não guarda o detalhe). */
export function blockCodeForGate(reason: PropertyGateReason): Extract<ShadowBlockCode, "scope_off" | "property_ineligible" | "property_disabled" | "tenant_disabled"> {
  if (reason === "scope_off" || reason === "tenant_disabled" || reason === "property_disabled") return reason;
  return "property_ineligible";
}

// ─────────────────────────── Registro de execução (sem texto livre) ───────────────────────────

export type ShadowTimings = { readonly [K in ChainTimingId]: number | null };

export interface ShadowExecutionRecord {
  readonly executionId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly conversationId: string;
  readonly batchId: string | null;
  readonly leaseVersion: number | null;
  readonly channel: ShadowChannel;
  readonly chainVersion: string;
  readonly shadowVersion: string;
  readonly composerVersion: string | null;
  readonly modelId: ShadowModelId | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly totalMs: number;
  readonly leaseMs: number;
  readonly contextMs: number;
  readonly gatewayMs: number;
  readonly validationMs: number;
  readonly timings: ShadowTimings;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly totalTokens: number;
  readonly usageSource: (typeof SHADOW_USAGE_SOURCES)[number];
  /** E3.1: decimal exato com 8 casas (`money.ts`), igual ao valor liquidado. */
  readonly costUsd: string;
  readonly gatewayCalls: number;
  readonly estimatedInputTokens: number | null;
  readonly candidateAvailable: boolean;
  readonly decision: ShadowDecision;
  readonly strategy: Strategy | null;
  readonly intents: readonly IntentCategory[];
  readonly intentCount: number;
  readonly commitmentKinds: readonly CommitmentKind[];
  readonly humanInterventionNeeded: boolean;
  readonly handoffUrgency: HandoffUrgency | null;
  readonly pauseState: ShadowPauseState;
  readonly contextCheck: ShadowContextCheck;
  readonly executionState: ShadowExecutionState;
  readonly responseDiscarded: true;
  readonly timeout: boolean;
  readonly tokenLimitViolation: boolean;
  readonly concurrencyDetected: boolean;
  readonly gatewayError: LlmErrorCode | null;
  readonly budgetExceeded: BudgetLimitId | null;
  readonly refusalCode: ChainRefusalCode | null;
  readonly technicalCode: ShadowTechnicalCode | null;
  readonly blockCode: ShadowBlockCode | null;
  readonly integrityCode: IntegrityCode | null;
}

/** Chaves exatas do registro (o teste de chaves é recursivo e fechado). */
export const SHADOW_RECORD_KEYS = [
  "executionId", "tenantId", "propertyId", "conversationId", "batchId", "leaseVersion", "channel", "chainVersion", "shadowVersion",
  "composerVersion", "modelId", "startedAt", "finishedAt", "totalMs", "leaseMs", "contextMs", "gatewayMs", "validationMs", "timings",
  "inputTokens", "outputTokens", "reasoningTokens", "totalTokens", "usageSource", "costUsd", "gatewayCalls", "estimatedInputTokens",
  "candidateAvailable", "decision", "strategy", "intents", "intentCount", "commitmentKinds", "humanInterventionNeeded", "handoffUrgency",
  "pauseState", "contextCheck", "executionState", "responseDiscarded", "timeout", "tokenLimitViolation", "concurrencyDetected",
  "gatewayError", "budgetExceeded", "refusalCode", "technicalCode", "blockCode", "integrityCode",
] as const satisfies readonly (keyof ShadowExecutionRecord)[];
type _RecordKeysExhaustive = Exclude<keyof ShadowExecutionRecord, (typeof SHADOW_RECORD_KEYS)[number]> extends never ? true : never;
const _recordKeysExhaustive: _RecordKeysExhaustive = true;
void _recordKeysExhaustive;

/** Resposta da rota: só códigos e contadores. */
export interface ShadowTickSummary {
  readonly outcome: "not_released" | "state_not_running" | "state_unreadable" | "limits_missing" | "scope_off" | "executed" | "tick_failed" | "tick_busy";
  readonly conversationsConsidered: number;
  readonly executed: number;
  readonly blocked: number;
  readonly failed: number;
}
